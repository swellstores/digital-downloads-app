import {
  addDays,
  deliverablesForVariant,
  downloadDenial,
  downloadsLeft,
  grantDenial,
  isDigital,
  isSubscriptionProduct,
  type Denial,
} from "./access";
import { loadCatalog, type CatalogEntry } from "./catalog";
import { isUniqueViolation } from "./errors";
import { issueKeys, listKeys, setKeysStatus, warnIfLow, type PoolUse } from "./licenses";
import { downloadsUrl, functionsBaseUrl } from "./links";
import { getSettings } from "./settings";
import { randomToken } from "./tokens";
import { mapLimit } from "./util";
import type {
  Deliverable,
  Grant,
  GrantStatus,
  Order,
  OrderAppValues,
  OrderItem,
  Page,
  Subscription,
} from "./types";

export function grantsPath(req: Pick<SwellRequest, "appId">): string {
  return `/apps/${req.appId}/grants`;
}

export async function listGrants(
  req: SwellRequest,
  where: Record<string, unknown>,
  limit = 100,
  sort = "date_created asc",
): Promise<Grant[]> {
  const page: Page<Grant> | null = await req.swell.get(grantsPath(req), {
    where,
    limit,
    sort,
  });

  return page?.results ?? [];
}

export function getOrder(req: SwellRequest, orderId: string): Promise<Order | null> {
  return req.swell.get(`/orders/${orderId}`);
}

export function orderAccess(req: SwellRequest, order: Order): OrderAppValues {
  return order.$app?.[req.appId!] ?? {};
}

/**
 * The order's downloads link token. Grants hold it because another app's
 * order write can race with ours and drop this app's order fields; the copy on
 * the order is only a convenience for themes. Orders granted before grants held
 * the token fall back to the order's copy.
 */
export function accessToken(req: SwellRequest, order: Order | null, grants: Grant[]): string | null {
  return grants.find((grant) => grant.access_token)?.access_token ?? (order ? orderAccess(req, order).access_token ?? null : null);
}

/** The order's downloads page, built from the token so it doesn't depend on the order's copy. */
export async function orderDownloadsUrl(
  req: SwellRequest,
  orderId: string,
  token: string,
  appObjectId?: string | null,
): Promise<string> {
  return downloadsUrl(await functionsBaseUrl(req, appObjectId), orderId, token);
}

export interface GrantResult {
  grants: Grant[];
  keysMissing: number;
  access: OrderAppValues;
  /** Whether the "downloads ready" email was sent */
  notified: boolean;
}

export interface GrantOptions {
  /**
   * Send the "downloads ready" email: `if_new` only when it hasn't been sent
   * for this order, `always` to resend. Never sent while access is revoked.
   */
  notify?: "if_new" | "always";
}

/**
 * Gives every digital item in a paid order its grant and license keys, then
 * writes the order's downloads link, sending the email in the same write. Safe
 * to run more than once: items that already have a grant are skipped and keys
 * are only topped up to quantity.
 */
export async function grantOrder(
  req: SwellRequest,
  order: Order,
  options: GrantOptions = {},
): Promise<GrantResult | null> {
  const items = order.items ?? [];

  // Functions time out after 10 seconds, so independent reads go out together
  const [catalog, settings, existing] = await Promise.all([
    loadCatalog(
      req,
      items.map((item) => item.product_id),
    ),
    getSettings(req),
    listGrants(req, { order_id: order.id }),
  ]);

  const digitalItems = items.filter((item) => {
    const entry = catalog.get(item.product_id);
    return entry ? isDigital(entry.config) : false;
  });

  if (digitalItems.length === 0) {
    return null;
  }

  const subscriptions = await loadSubscriptions(req, order, digitalItems, catalog);

  const now = new Date();
  const token = accessToken(req, order, existing) ?? randomToken();
  const poolUse = new Map<string, PoolUse>();
  let keysMissing = 0;

  // Items are independent, so they're granted side by side to stay inside the
  // 10 second timeout. Pool claims racing for one key are settled by $inc.
  const granted = await mapLimit(digitalItems, 4, async (item): Promise<Grant | null> => {
    const { product, config } = catalog.get(item.product_id)!;
    const subscription = isSubscriptionProduct(product)
      ? subscriptionFor(subscriptions, order, item)
      : null;

    let grant = existing.find((existingGrant) => existingGrant.item_id === item.id) ?? null;
    let newGrant = false;

    if (!grant && subscription) {
      // Renewal orders repeat the subscription's item. Access already follows
      // the grant made for the first order.
      const [first] = await listGrants(req, { subscription_id: subscription.id }, 1);

      if (first) {
        return null;
      }
    }

    if (!grant) {
      [grant, newGrant] = await createGrant(req, {
        order_id: order.id,
        item_id: item.id,
        account_id: order.account_id ?? null,
        product_id: item.product_id,
        variant_id: item.variant_id ?? null,
        subscription_id: subscription?.id ?? null,
        access_token: token,
        quantity: item.quantity,
        status: "active",
        download_limit: config.download_limit ?? settings.delivery.download_limit ?? null,
        // Subscription access follows the subscription instead of a fixed period
        date_expires: subscription
          ? null
          : addDays(now, config.access_days ?? settings.delivery.access_days),
      });
    }

    if (grant && config.license_enabled && grant.status === "active") {
      const { issued, missing } = await issueKeys(
        req,
        grant,
        config,
        item.quantity,
        subscription,
        newGrant,
      );

      keysMissing += missing;

      if (config.license_source === "pool") {
        const use = poolUse.get(item.product_id) ?? { claimed: 0, missing: 0 };
        poolUse.set(item.product_id, {
          claimed: use.claimed + issued,
          missing: use.missing + missing,
        });
      }
    }

    return grant;
  });

  const grants = granted.filter((grant): grant is Grant => grant !== null);

  if (grants.length === 0) {
    return null;
  }

  // Grants made before grants held the token get the order's
  await Promise.all(
    grants
      .filter((grant) => grant.access_token !== token)
      .map(async (grant) => {
        await req.swell.put(`${grantsPath(req)}/${grant.id}`, { access_token: token });
        grant.access_token = token;
      }),
  );

  // Re-running on an order whose access was revoked keeps it revoked
  const accessStatus = grants.some((grant) => grant.status !== "revoked") ? "granted" : "revoked";
  const notify =
    accessStatus === "granted" &&
    (options.notify === "always" ||
      (options.notify === "if_new" && !orderAccess(req, order).date_notified));

  const [access] = await Promise.all([
    writeOrderAccess(
      req,
      order,
      token,
      { access_status: accessStatus, keys_missing: keysMissing || null },
      settings.id,
      notify ? { grants, catalog } : undefined,
    ),
    ...[...poolUse].map(([productId, use]) =>
      warnIfLow(req, productId, use, settings.licenses.low_stock_threshold, order.number),
    ),
  ]);

  return { grants, keysMissing, access, notified: notify };
}

/** Returns the grant, and whether this call created it. */
async function createGrant(
  req: SwellRequest,
  values: Omit<Grant, "id">,
): Promise<[Grant | null, boolean]> {
  try {
    return [(await req.swell.post(grantsPath(req), values)) as Grant, true];
  } catch (err) {
    // A duplicate delivery of the same event got there first
    if (isUniqueViolation(err, "item_id")) {
      const [grant] = await listGrants(req, { order_id: values.order_id, item_id: values.item_id }, 1);
      return [grant ?? null, false];
    }

    throw err;
  }
}

async function loadSubscriptions(
  req: SwellRequest,
  order: Order,
  items: OrderItem[],
  catalog: Map<string, CatalogEntry>,
): Promise<Subscription[]> {
  const hasSubscription = items.some((item) =>
    isSubscriptionProduct(catalog.get(item.product_id)!.product),
  );

  if (!hasSubscription) {
    return [];
  }

  // The first order created the subscription; renewal orders point at it
  const where = order.subscription_id ? { id: order.subscription_id } : { order_id: order.id };
  const page: Page<Subscription> | null = await req.swell.get("/subscriptions", { where, limit: 100 });

  return page?.results ?? [];
}

function subscriptionFor(
  subscriptions: Subscription[],
  order: Order,
  item: OrderItem,
): Subscription | null {
  return (
    subscriptions.find((subscription) => subscription.order_item_id === item.id) ??
    subscriptions.find((subscription) => subscription.id === order.subscription_id) ??
    null
  );
}

/**
 * Writes the order's copy of the access token and its downloads link. The
 * token comes from the order's grants and stays the same, so links in sent
 * emails keep working.
 *
 * With `email`, the "downloads ready" email goes out in the same write. Order
 * writes are expensive (every one runs the order's formulas and other apps'
 * order.updated handlers), and a notification is only sent with a write that
 * changes the record anyway.
 */
export async function writeOrderAccess(
  req: SwellRequest,
  order: Order,
  token: string,
  values: Partial<OrderAppValues>,
  appObjectId?: string | null,
  email?: { grants: Grant[]; catalog: Map<string, CatalogEntry> },
): Promise<OrderAppValues> {
  const current = orderAccess(req, order);
  const now = new Date().toISOString();

  const next: OrderAppValues = {
    access_token: token,
    downloads_url: await orderDownloadsUrl(req, order.id, token, appObjectId),
    date_granted: current.date_granted ?? now,
    ...values,
    ...(email ? { date_notified: now } : {}),
  };

  const $notify = email
    ? await downloadsNotification(req, order, next.downloads_url!, email.grants, email.catalog)
    : undefined;

  await req.swell.put(`/orders/${order.id}`, {
    ...req.appValues(next),
    ...($notify ? { $notify } : {}),
  });

  return { ...current, ...next };
}

async function downloadsNotification(
  req: SwellRequest,
  order: Order,
  downloadsUrl: string,
  grants: Grant[],
  catalog: Map<string, CatalogEntry>,
) {
  const items = await describeGrants(req, grants, new Map([[order.id, order]]), catalog);

  return {
    id: `${req.appId}.downloads-ready`,
    data: {
      downloads_url: downloadsUrl,
      downloads: items
        .filter((item) => !item.denial)
        .map((item) => ({
          product_name: item.product_name,
          variant_name: item.variant_name,
          deliverables: item.deliverables.map(({ name, version }) => ({ name, version })),
          license_keys: item.license_keys.map(({ key }) => key),
        })),
    },
  };
}

/**
 * Moves an order's grants that are in one of `from` to `to`, and keeps their
 * license keys in step: revoked grants revoke their keys and restored grants
 * restore them. Suspension leaves keys alone; the license API checks the grant.
 */
export async function setOrderGrantsStatus(
  req: SwellRequest,
  orderId: string,
  from: GrantStatus[],
  to: GrantStatus,
  reason: string | null,
): Promise<Grant[]> {
  const grants = (await listGrants(req, { order_id: orderId })).filter((grant) =>
    from.includes(grant.status),
  );

  await Promise.all(
    grants.map((grant) => req.swell.put(`${grantsPath(req)}/${grant.id}`, { status: to, reason })),
  );

  const ids = grants.map((grant) => grant.id);

  if (to === "revoked") {
    await setKeysStatus(req, ids, "assigned", "revoked");
  } else if (to === "active") {
    await setKeysStatus(req, ids, "revoked", "assigned");
  }

  return grants;
}

export interface DeliverableView {
  id: string;
  name: string;
  version: string | null;
  source: Deliverable["source"];
  downloads_left: number | null;
  denial: Denial | null;
}

export interface KeyView {
  key: string;
  status: string;
  date_expires: string | null;
  activations_used: number;
  activation_limit: number | null;
}

export interface ItemView {
  grant: Grant;
  product_name: string;
  variant_name: string | null;
  denial: Denial | null;
  deliverables: DeliverableView[];
  license_keys: KeyView[];
}

/** What the buyer of an order can see: each item's deliverables, limits and keys. */
export async function describeOrder(req: SwellRequest, order: Order): Promise<ItemView[]> {
  const grants = await listGrants(req, { order_id: order.id });

  return describeGrants(req, grants, new Map([[order.id, order]]));
}

/** Like describeOrder, for grants from many orders at once. */
export async function describeGrants(
  req: SwellRequest,
  grants: Grant[],
  orders: Map<string, Order>,
  knownCatalog?: Map<string, CatalogEntry>,
): Promise<ItemView[]> {
  if (grants.length === 0) {
    return [];
  }

  const [catalog, keys] = await Promise.all([
    knownCatalog ??
      loadCatalog(
        req,
        grants.map((grant) => grant.product_id),
      ),
    listKeys(req, { grant_id: { $in: grants.map((grant) => grant.id) } }, 1000),
  ]);

  const now = new Date();

  return grants.map((grant) => {
    const entry = catalog.get(grant.product_id);
    const order: Order = orders.get(grant.order_id) ?? { id: grant.order_id };
    const item = order.items?.find((orderItem) => orderItem.id === grant.item_id);

    return {
      grant,
      product_name: item?.product_name ?? entry?.product.name ?? "Your purchase",
      variant_name: item?.variant?.name ?? null,
      denial: grantDenial(grant, order, now),
      deliverables: deliverablesForVariant(entry?.config.deliverables ?? [], grant.variant_id).map(
        (deliverable) => ({
          id: deliverable.id,
          name: deliverable.name,
          version: deliverable.version ?? null,
          source: deliverable.source ?? "link",
          downloads_left: downloadsLeft(grant, deliverable.id),
          denial: downloadDenial(grant, order, deliverable.id, now),
        }),
      ),
      license_keys: keys
        .filter((key) => key.grant_id === grant.id)
        .map((key) => ({
          key: key.key,
          status: key.status,
          date_expires: key.date_expires ?? null,
          activations_used: key.activations?.length ?? 0,
          activation_limit: key.activation_limit ?? null,
        })),
    };
  });
}
