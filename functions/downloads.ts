import {
  DENIAL_MESSAGES,
  deliverablesForVariant,
  downloadDenial,
  isSafeLink,
} from "./lib/access";
import { loadCatalog } from "./lib/catalog";
import { accessToken, describeOrder, getOrder, grantsPath, listGrants } from "./lib/grants";
import { htmlResponse, renderDownloadsPage, renderMessagePage } from "./lib/html";
import { openBucket, presignDownload } from "./lib/s3";
import { getSettings } from "./lib/settings";
import { isObjectId, safeEqual } from "./lib/tokens";
import type { Deliverable, Grant, Order } from "./lib/types";

export const config: SwellConfig = {
  description: "Buyer downloads page: lists an order's files, links and keys, and redirects each download after checking access",
  route: {
    methods: ["get", "post"],
    public: true,
    cache: { timeout: 0 },
  },
};

/** Opening the page from the email link. Viewing never counts as a download. */
export async function get(req: SwellRequest) {
  const order = await authorize(req, req.data);

  if (!order) {
    return invalidLink();
  }

  return renderPage(req, order, req.data.token);
}

/**
 * A Download/Open button. Only button posts count, so link scanners that
 * prefetch the emailed link can't use up a buyer's downloads. The gateway drops
 * query parameters when there's a body, so the form sends everything.
 */
export async function post(req: SwellRequest) {
  const input = formInput(req.body);

  // Read together to save a round trip; the grant is only used once the token checks out
  const [order, grant]: [Order | null, Grant | null] = await Promise.all([
    authorize(req, input),
    isObjectId(input.grant) ? req.swell.get(`${grantsPath(req)}/${input.grant}`) : null,
  ]);

  if (!order) {
    return invalidLink();
  }

  const token = input.token;

  if (!grant || grant.order_id !== order.id || !isObjectId(input.deliverable)) {
    return renderPage(req, order, token, "That download wasn't found.", 404);
  }

  const catalog = await loadCatalog(req, [grant.product_id]);
  const deliverable = deliverablesForVariant(
    catalog.get(grant.product_id)?.config.deliverables ?? [],
    grant.variant_id,
  ).find((candidate) => candidate.id === input.deliverable);

  if (!deliverable) {
    return renderPage(req, order, token, "That download is no longer available.", 404);
  }

  const denial = downloadDenial(grant, order, deliverable.id);

  if (denial) {
    return renderPage(req, order, token, DENIAL_MESSAGES[denial], 403);
  }

  const destination = await destinationFor(req, deliverable);

  if (!destination) {
    return renderPage(
      req,
      order,
      token,
      "This download isn't set up correctly. Please contact the store.",
      503,
    );
  }

  await recordDownload(req, grant, deliverable);

  return new SwellResponse(undefined, {
    status: 303,
    headers: {
      Location: destination,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function authorize(req: SwellRequest, input: Record<string, any>): Promise<Order | null> {
  const { order: orderId, token } = input;

  if (!isObjectId(orderId) || typeof token !== "string" || token.length < 16) {
    return null;
  }

  const [order, grants] = await Promise.all([
    getOrder(req, orderId),
    listGrants(req, { order_id: orderId }, 1),
  ]);
  const expected = accessToken(req, order, grants);

  return order && expected && safeEqual(token, expected) ? order : null;
}

/** Form posts usually arrive re-serialized as JSON, but accept raw form text too. */
function formInput(body: unknown): Record<string, any> {
  if (typeof body === "string") {
    const input: Record<string, string> = {};
    new URLSearchParams(body).forEach((value, key) => {
      input[key] = value;
    });
    return input;
  }

  return body && typeof body === "object" ? (body as Record<string, any>) : {};
}

async function renderPage(
  req: SwellRequest,
  order: Order,
  token: string,
  notice: string | null = null,
  status = 200,
) {
  const items = await describeOrder(req, order);

  return htmlResponse(
    renderDownloadsPage({ orderId: order.id, token, orderNumber: order.number, items, notice }),
    status,
  );
}

function invalidLink() {
  return htmlResponse(
    renderMessagePage(
      "This link isn't valid",
      "Check that you opened the whole link from your email, or ask the store to resend it.",
    ),
    404,
  );
}

/** Bucket files get a link that expires in minutes; links go straight to their URL. */
async function destinationFor(req: SwellRequest, deliverable: Deliverable): Promise<string | null> {
  if (deliverable.source === "bucket") {
    const bucket = openBucket((await getSettings(req)).storage);

    if (!bucket || !deliverable.object_key) {
      return null;
    }

    return presignDownload(
      bucket,
      deliverable.object_key,
      deliverable.filename || deliverable.name,
    );
  }

  return isSafeLink(deliverable.url) ? deliverable.url : null;
}

async function recordDownload(req: SwellRequest, grant: Grant, deliverable: Deliverable) {
  await req.swell.put(`${grantsPath(req)}/${grant.id}`, {
    $inc: { [`download_counts.${deliverable.id}`]: 1 },
    date_last_download: new Date().toISOString(),
  });

  // The log isn't needed to redirect, so it's written after responding
  req.context.waitUntil(
    req.swell
      .post(`/apps/${req.appId}/download-events`, {
        grant_id: grant.id,
        order_id: grant.order_id,
        product_id: grant.product_id,
        deliverable_id: deliverable.id,
        deliverable_name: deliverable.name,
        ip: clientIp(req),
        user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
      })
      .catch((err: unknown) => console.error("Could not log download", err)),
  );
}

function clientIp(req: SwellRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    null
  );
}
