import { digitalConfig } from "./access";
import type { Deliverable, DigitalConfig, Page, Product } from "./types";

export interface CatalogEntry {
  product: Product & { delivery?: string };
  config: DigitalConfig;
}

/** Products and their digital config, keyed by product id. */
export async function loadCatalog(
  req: SwellRequest,
  productIds: string[],
): Promise<Map<string, CatalogEntry>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const catalog = new Map<string, CatalogEntry>();

  if (ids.length === 0) {
    return catalog;
  }

  const [products, deliverables] = await Promise.all([
    req.swell.get("/products", {
      where: { id: { $in: ids } },
      limit: ids.length,
    }),
    loadDeliverables(req, ids),
  ]);

  for (const product of products?.results ?? []) {
    catalog.set(product.id, {
      product,
      config: digitalConfig(product, req.appId!, deliverables.get(product.id) ?? []),
    });
  }

  return catalog;
}

/**
 * Deliverables are an app child collection on products. They're read from the
 * collection directly, in one query, so it doesn't matter whether product reads
 * include them inline.
 */
async function loadDeliverables(
  req: SwellRequest,
  productIds: string[],
): Promise<Map<string, Deliverable[]>> {
  const page: Page<Deliverable> | null = await req.swell.get(
    deliverablesPath(req),
    { where: { parent_id: { $in: productIds } }, limit: 1000 },
  );

  const byProduct = new Map<string, Deliverable[]>();

  for (const deliverable of page?.results ?? []) {
    if (!deliverable.parent_id) {
      continue;
    }

    const list = byProduct.get(deliverable.parent_id) ?? [];
    list.push(deliverable);
    byProduct.set(deliverable.parent_id, list);
  }

  return byProduct;
}

export function deliverablesPath(req: Pick<SwellRequest, "appId">): string {
  return `/products:apps.${req.appId}.deliverables`;
}
