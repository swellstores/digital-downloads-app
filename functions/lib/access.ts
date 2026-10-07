import type { Deliverable, DigitalConfig, Grant, Order, Product } from "./types";

export type Denial =
  | "revoked"
  | "suspended"
  | "canceled"
  | "refunded"
  | "expired"
  | "limit";

export const DENIAL_MESSAGES: Record<Denial, string> = {
  revoked: "Access to this purchase has been removed.",
  suspended: "Downloads are paused while your subscription isn't active.",
  canceled: "This order was canceled.",
  refunded: "This order was refunded.",
  expired: "Your download period has ended.",
  limit: "You've used all the downloads for this item.",
};

const DAY_MS = 86_400_000;

/** A child collection can come back as a plain array or as a page of results. */
export function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object" && Array.isArray((value as any).results)) {
    return (value as any).results;
  }

  return [];
}

export function digitalConfig(
  product: Product,
  appId: string,
  deliverables?: Deliverable[],
): DigitalConfig {
  const values = product.$app?.[appId] ?? {};

  return {
    ...values,
    deliverables: deliverables ?? toArray<Deliverable>(values.deliverables),
  };
}

export function isDigital(config: DigitalConfig): boolean {
  return config.deliverables.length > 0 || config.license_enabled === true;
}

export function isSubscriptionProduct(product: Product & { delivery?: string }): boolean {
  return product.type === "subscription" || product.delivery === "subscription";
}

/** Deliverables without a variant apply to every variant. */
export function deliverablesForVariant(
  deliverables: Deliverable[],
  variantId?: string | null,
): Deliverable[] {
  return deliverables.filter(
    (deliverable) => !deliverable.variant_id || deliverable.variant_id === variantId,
  );
}

export function addDays(from: Date, days?: number | null): string | null {
  return days ? new Date(from.getTime() + days * DAY_MS).toISOString() : null;
}

/** Why a grant can't be used right now, or null when it can. */
export function grantDenial(
  grant: Grant,
  order: Pick<Order, "canceled" | "refunded">,
  now = new Date(),
): Denial | null {
  if (grant.status === "revoked") {
    return "revoked";
  }

  if (grant.status === "suspended") {
    return "suspended";
  }

  if (order.canceled) {
    return "canceled";
  }

  if (order.refunded) {
    return "refunded";
  }

  if (grant.date_expires && new Date(grant.date_expires) <= now) {
    return "expired";
  }

  return null;
}

/** Downloads left for one deliverable, or null when unlimited. */
export function downloadsLeft(grant: Grant, deliverableId: string): number | null {
  if (!grant.download_limit) {
    return null;
  }

  const used = grant.download_counts?.[deliverableId] ?? 0;

  return Math.max(grant.download_limit - used, 0);
}

export function downloadDenial(
  grant: Grant,
  order: Pick<Order, "canceled" | "refunded">,
  deliverableId: string,
  now = new Date(),
): Denial | null {
  return (
    grantDenial(grant, order, now) ??
    (downloadsLeft(grant, deliverableId) === 0 ? "limit" : null)
  );
}

/** Only https destinations are delivered, so a link can't run script or open a local file. */
export function isSafeLink(url: unknown): url is string {
  if (typeof url !== "string") {
    return false;
  }

  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
