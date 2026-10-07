import { countAvailable } from "./lib/licenses";
import type { OrderItem, Page, Product } from "./lib/types";

export const config: SwellConfig = {
  description: "Stop an order when a product's imported license keys can't cover it",
  timeout: 5000,
  model: {
    events: ["before:order.created"],
  },
};

/**
 * Runs inside order creation, so it does the least it can: one product query,
 * and key counts only for products that sell from a key pool. Hook errors fail
 * open, so a failure here never blocks checkout; grant-access then emails
 * admins about any order left without keys.
 */
export default async function (req: SwellRequest) {
  const items: OrderItem[] = req.data.items ?? [];

  // Renewals keep the subscription's existing key
  if (items.length === 0 || req.data.subscription_id) {
    return;
  }

  const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))];

  const pooled: Page<Product> | null = await req.swell.get("/products", {
    where: {
      id: { $in: productIds },
      [`$app.${req.appId}.license_enabled`]: true,
      [`$app.${req.appId}.license_source`]: "pool",
    },
    fields: "id,name",
    limit: productIds.length,
  });

  for (const product of pooled?.results ?? []) {
    const needed = new Map<string, number>();

    for (const item of items) {
      if (item.product_id === product.id) {
        const variant = item.variant_id ?? "";
        needed.set(variant, (needed.get(variant) ?? 0) + (item.quantity ?? 1));
      }
    }

    for (const [variantId, quantity] of needed) {
      const available = await countAvailable(req, product.id, variantId || null);

      if (available < quantity) {
        throw req.reject(
          "license_keys_sold_out",
          available > 0
            ? `Only ${available} of ${product.name} left.`
            : `${product.name} is sold out.`,
          { status: 409 },
        );
      }
    }
  }
}
