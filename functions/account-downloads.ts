import { describeGrants, listGrants, orderAccess } from "./lib/grants";
import type { Order, Page } from "./lib/types";

export const config: SwellConfig = {
  description: "Downloads and license keys for the signed-in customer, for account pages in headless themes",
  route: {
    methods: ["get"],
    public: true,
    cache: { timeout: 0 },
  },
};

// Keeps the response well under the 75 KB function response limit
const MAX_GRANTS = 50;

/**
 * Call from a theme with swell.functions.get('digital_downloads', 'account-downloads').
 * Download buttons should link to each order's downloads_url, which checks
 * access and counts downloads.
 */
export async function get(req: SwellRequest) {
  const accountId = req.session?.account_id;

  if (!accountId) {
    throw new SwellError("Sign in to see your downloads", { status: 401 });
  }

  const grants = await listGrants(req, { account_id: accountId }, MAX_GRANTS, "date_created desc");

  if (grants.length === 0) {
    return { orders: [] };
  }

  const orderIds = [...new Set(grants.map((grant) => grant.order_id))];
  const page: Page<Order> | null = await req.swell.get("/orders", {
    where: { id: { $in: orderIds } },
    limit: orderIds.length,
  });

  const orders = new Map((page?.results ?? []).map((order) => [order.id, order]));
  const items = await describeGrants(req, grants, orders);

  return {
    orders: orderIds
      .map((orderId) => orders.get(orderId))
      .filter((order): order is Order => Boolean(order))
      .map((order) => ({
        id: order.id,
        number: order.number ?? null,
        date_created: order.date_created ?? null,
        downloads_url: orderAccess(req, order).downloads_url ?? null,
        items: items
          .filter((item) => item.grant.order_id === order.id)
          .map((item) => ({
            product_id: item.grant.product_id,
            product_name: item.product_name,
            variant_name: item.variant_name,
            status: item.denial ?? "active",
            date_expires: item.grant.date_expires ?? null,
            deliverables: item.deliverables.map(({ id, name, version, downloads_left }) => ({
              id,
              name,
              version,
              downloads_left,
            })),
            license_keys: item.denial ? [] : item.license_keys,
          })),
      })),
  };
}
