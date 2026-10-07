import type { StorageSettings } from "./s3";

export interface DeliverySettings {
  download_limit?: number | null;
  access_days?: number | null;
}

export interface LicenseSettings {
  low_stock_threshold?: number | null;
}

export interface AppSettings {
  /** The installed app's ObjectId, which the settings record is keyed by */
  id?: string;
  delivery: DeliverySettings;
  licenses: LicenseSettings;
  storage: StorageSettings;
}

// Installed apps start with empty settings: defaults in settings/*.json are
// only shown in the form, so the code applies them when a value is unset
const DEFAULT_LOW_STOCK_THRESHOLD = 10;

/** Settings come back namespaced by settings file name. */
export async function getSettings(req: SwellRequest): Promise<AppSettings> {
  const all = (await req.swell.settings()) ?? {};

  return {
    id: all.id,
    delivery: all.delivery ?? {},
    licenses: {
      ...all.licenses,
      low_stock_threshold: all.licenses?.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
    },
    storage: all.storage ?? {},
  };
}
