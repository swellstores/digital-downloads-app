import { isObjectId } from "./tokens";

/**
 * Base URL of this app's route functions on the store's swell.store domain.
 *
 * Links in emails can't send an API key, and without one the gateway only finds
 * a function by the installed app's ObjectId, not by its slug. GET
 * /settings/<slug> returns that id.
 */
export async function functionsBaseUrl(
  req: SwellRequest,
  appObjectId?: string | null,
): Promise<string> {
  const storeUrl = (req.store.admin_url || req.store.url || "").replace(/\/admin\/?$/, "");
  const appRef = isObjectId(appObjectId) ? appObjectId : await installedAppId(req);

  return `${storeUrl}/functions/${appRef}`;
}

async function installedAppId(req: SwellRequest): Promise<string> {
  const settings: { id?: string } | null = await req.swell.get(`/settings/${req.appId}`, {
    fields: "id",
  });

  if (isObjectId(settings?.id)) {
    return settings.id;
  }

  // Worker script names look like prd_<app id>_<function>__<hash>
  const fromScript = req.headers
    .get("Swell-Function-Name")
    ?.match(/^[a-z]+_([0-9a-f]{24})_/i)?.[1];

  return fromScript ?? req.appId;
}

export function downloadsUrl(base: string, orderId: string, token: string): string {
  return `${base}/downloads?order=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`;
}
