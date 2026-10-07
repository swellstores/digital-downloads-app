export interface Deliverable {
  id: string;
  parent_id?: string;
  name: string;
  source?: "link" | "bucket";
  url?: string | null;
  object_key?: string | null;
  filename?: string | null;
  size?: number | null;
  content_type?: string | null;
  variant_id?: string | null;
  version?: string | null;
  date_updated?: string;
}

/** A product's `$app.digital_downloads` values, with deliverables loaded. */
export interface DigitalConfig {
  deliverables: Deliverable[];
  download_limit?: number | null;
  access_days?: number | null;
  license_enabled?: boolean;
  license_source?: "generate" | "pool";
  license_pattern?: string | null;
  license_activation_limit?: number | null;
  license_valid_days?: number | null;
}

export interface Product {
  id: string;
  name: string;
  type?: string;
  $app?: Record<string, any>;
}

export interface OrderItem {
  id: string;
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  product_name?: string;
  variant?: { name?: string } | null;
}

export interface Order {
  id: string;
  number?: string;
  account_id?: string | null;
  subscription_id?: string | null;
  items?: OrderItem[];
  grand_total?: number;
  draft?: boolean;
  paid?: boolean;
  canceled?: boolean;
  refunded?: boolean;
  date_created?: string;
  account?: { email?: string; first_name?: string; name?: string } | null;
  $app?: Record<string, any>;
}

export interface OrderAppValues {
  access_token?: string | null;
  downloads_url?: string | null;
  access_status?: "granted" | "revoked" | null;
  date_granted?: string | null;
  date_notified?: string | null;
  keys_missing?: number | null;
}

export type GrantStatus = "active" | "suspended" | "revoked";

export interface Grant {
  id: string;
  order_id: string;
  item_id: string;
  account_id?: string | null;
  product_id: string;
  variant_id?: string | null;
  subscription_id?: string | null;
  /** Secret in the order's downloads link, the same on every grant of the order */
  access_token?: string | null;
  quantity?: number;
  status: GrantStatus;
  reason?: string | null;
  download_counts?: Record<string, number> | null;
  download_limit?: number | null;
  date_expires?: string | null;
  date_last_download?: string | null;
  date_created?: string;
}

export interface Activation {
  instance_id: string;
  name?: string | null;
  date_created?: string;
}

export interface LicenseKey {
  id: string;
  key: string;
  product_id: string;
  variant_id?: string | null;
  source: "generated" | "pool";
  status: "available" | "assigned" | "revoked";
  claims?: number;
  order_id?: string | null;
  item_id?: string | null;
  grant_id?: string | null;
  account_id?: string | null;
  subscription_id?: string | null;
  activation_limit?: number | null;
  activations?: Activation[] | null;
  date_assigned?: string | null;
  date_expires?: string | null;
}

export interface Subscription {
  id: string;
  status?: string;
  order_id?: string | null;
  order_item_id?: string | null;
  date_period_end?: string | null;
  canceled?: boolean;
  paused?: boolean;
}

export interface Page<T> {
  count?: number;
  results: T[];
}
