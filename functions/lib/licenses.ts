import { addDays } from "./access";
import { isUniqueViolation } from "./errors";
import type { DigitalConfig, Grant, LicenseKey, Page, Subscription } from "./types";
import { mapLimit } from "./util";

export const DEFAULT_PATTERN = "XXXXX-XXXXX-XXXXX-XXXXX";

// 16 characters from a 32-character alphabet is 80 bits, too many to guess
const MIN_RANDOM_CHARS = 16;

// No 0/O or 1/I, so keys survive being read aloud or retyped
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function keysPath(req: Pick<SwellRequest, "appId">): string {
  return `/apps/${req.appId}/license-keys`;
}

/**
 * Each X in the pattern becomes a random character. Patterns with fewer than
 * 16 Xs fall back to the default so keys can't be guessed.
 */
export function generateKey(pattern?: string | null): string {
  const template =
    pattern && (pattern.match(/X/g)?.length ?? 0) >= MIN_RANDOM_CHARS
      ? pattern
      : DEFAULT_PATTERN;

  const random = crypto.getRandomValues(new Uint8Array(template.length));

  // 256 is a multiple of 32, so masking keeps every character equally likely
  return template.replace(/X/g, (_match, offset: number) => ALPHABET[random[offset] & 31]);
}

export async function listKeys(
  req: SwellRequest,
  where: Record<string, unknown>,
  limit = 100,
): Promise<LicenseKey[]> {
  const page: Page<LicenseKey> | null = await req.swell.get(keysPath(req), { where, limit });

  return page?.results ?? [];
}

/**
 * Unclaimed pool keys for a variant, plus keys that fit any variant. Function
 * GET queries are sent as query strings, where `null` arrives as the string
 * "null", so keys for any variant are stored without variant_id and matched
 * with $exists.
 */
export function poolWhere(productId: string, variantId?: string | null) {
  const anyVariant = { variant_id: { $exists: false } };

  return {
    product_id: productId,
    source: "pool",
    status: "available",
    claims: 0,
    ...(variantId ? { $or: [{ variant_id: variantId }, anyVariant] } : anyVariant),
  };
}

export async function countAvailable(
  req: SwellRequest,
  productId: string,
  variantId?: string | null,
): Promise<number> {
  const page: Page<LicenseKey> | null = await req.swell.get(keysPath(req), {
    where: poolWhere(productId, variantId),
    limit: 1,
  });

  return page?.count ?? 0;
}

export interface IssueResult {
  issued: number;
  missing: number;
}

/**
 * Tops a grant up to one key per unit bought. `missing` counts keys it's still
 * owed because the product's pool ran out.
 */
export async function issueKeys(
  req: SwellRequest,
  grant: Grant,
  config: DigitalConfig,
  quantity: number,
  subscription?: Subscription | null,
  newGrant = false,
): Promise<IssueResult> {
  // A grant created moments ago can't have keys yet
  const existing = newGrant ? [] : await listKeys(req, { grant_id: grant.id }, quantity);
  const needed = Math.max(quantity - existing.length, 0);
  const now = new Date();

  const assignment = {
    status: "assigned",
    order_id: grant.order_id,
    item_id: grant.item_id,
    grant_id: grant.id,
    account_id: grant.account_id ?? null,
    subscription_id: subscription?.id ?? null,
    activation_limit: config.license_activation_limit ?? null,
    date_assigned: now.toISOString(),
    // Subscription keys stay valid through the paid period and are extended on renewal
    date_expires:
      subscription?.date_period_end ?? addDays(now, config.license_valid_days),
  };

  // Several keys at once keeps large quantities inside the function timeout.
  // A timed-out run is retried, and the lookup above makes the retry top up.
  const results = await mapLimit(Array.from({ length: needed }), 5, async () => {
    if (config.license_source === "pool") {
      const key = await claimPoolKey(req, grant.product_id, grant.variant_id);

      if (!key) {
        return false;
      }

      await req.swell.put(`${keysPath(req)}/${key.id}`, assignment);
      return true;
    }

    await createGeneratedKey(
      req,
      {
        ...assignment,
        product_id: grant.product_id,
        ...(grant.variant_id ? { variant_id: grant.variant_id } : {}),
        source: "generated",
      },
      config.license_pattern,
    );

    return true;
  });

  const issued = results.filter(Boolean).length;

  return { issued, missing: needed - issued };
}

/**
 * `$inc` on `claims` is atomic, so of several orders racing for one key exactly
 * one gets back claims === 1. If concurrent claims leave every racer seeing 2,
 * that key is skipped rather than shared.
 */
async function claimPoolKey(
  req: SwellRequest,
  productId: string,
  variantId?: string | null,
): Promise<LicenseKey | null> {
  for (let round = 0; round < 5; round++) {
    const candidates = await listKeys(req, poolWhere(productId, variantId), 5);

    if (candidates.length === 0) {
      return null;
    }

    for (const candidate of candidates) {
      const claimed: LicenseKey | null = await req.swell.put(`${keysPath(req)}/${candidate.id}`, {
        $inc: { claims: 1 },
      });

      if (claimed?.claims === 1) {
        return claimed;
      }
    }
  }

  return null;
}

async function createGeneratedKey(
  req: SwellRequest,
  values: Record<string, unknown>,
  pattern?: string | null,
): Promise<LicenseKey> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (await req.swell.post(keysPath(req), {
        ...values,
        key: generateKey(pattern),
      })) as LicenseKey;
    } catch (err) {
      if (!isUniqueViolation(err, "key")) {
        throw err;
      }
    }
  }

  throw new Error("Could not generate a unique license key");
}

/** Moves the keys of the given grants from one status to another. */
export async function setKeysStatus(
  req: SwellRequest,
  grantIds: string[],
  from: LicenseKey["status"],
  to: LicenseKey["status"],
): Promise<void> {
  if (grantIds.length === 0) {
    return;
  }

  const keys = await listKeys(req, { grant_id: { $in: grantIds }, status: from }, 1000);

  await Promise.all(
    keys.map((key) => req.swell.put(`${keysPath(req)}/${key.id}`, { status: to })),
  );
}

export async function extendSubscriptionKeys(
  req: SwellRequest,
  subscriptionId: string,
  dateExpires: string,
): Promise<void> {
  const keys = await listKeys(req, { subscription_id: subscriptionId, status: "assigned" });

  await Promise.all(
    keys.map((key) =>
      req.swell.put(`${keysPath(req)}/${key.id}`, { date_expires: dateExpires }),
    ),
  );
}

export interface PoolUse {
  claimed: number;
  missing: number;
}

/**
 * Emails store admins when a sale takes a product's pool down to the warning
 * level, or leaves an order without the keys it paid for.
 */
export async function warnIfLow(
  req: SwellRequest,
  productId: string,
  use: PoolUse,
  threshold: number | null | undefined,
  orderNumber?: string,
): Promise<void> {
  const available = await countAvailable(req, productId);
  const level = threshold ?? 0;
  const crossed = available <= level && available + use.claimed > level;

  if (!crossed && use.missing === 0) {
    return;
  }

  // An email is only sent with a write that changes the record
  await req.swell.put(`/products/${productId}`, {
    ...req.appValues({ date_keys_low_notified: new Date().toISOString() }),
    $notify: {
      id: `${req.appId}.license-keys-low`,
      data: {
        available,
        missing: use.missing,
        order_number: use.missing > 0 ? orderNumber ?? null : null,
      },
    },
  });
}
