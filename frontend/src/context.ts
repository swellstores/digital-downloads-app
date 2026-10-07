/**
 * Verifies the Swell-Context header the dashboard proxy signs for app
 * frontends. It's an ES256 JWT whose `admin` claim is set only when a
 * signed-in admin made the request, so the app can trust it without calling
 * back to Swell. The proxy drops any Swell headers a browser sends.
 */
export interface SwellContext {
  store_id: string;
  environment_id: string | null;
  app_id: string;
  installation_id: string;
  api_host: string;
  admin: { user_id: string } | null;
}

interface SigningKey {
  kid?: string;
  kty: string;
  crv: string;
  x: string;
  y: string;
}

const ISSUERS = ["https://swell.store"];
const KEYS_TTL_MS = 5 * 60 * 1000;
const keyCache = new Map<string, { keys: SigningKey[]; fetched: number }>();

function decode(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function decodeJson(part: string): any {
  return JSON.parse(new TextDecoder().decode(decode(part)));
}

async function issuerKeys(issuer: string, refresh = false): Promise<SigningKey[]> {
  const cached = keyCache.get(issuer);

  if (cached && !refresh && Date.now() - cached.fetched < KEYS_TTL_MS) {
    return cached.keys;
  }

  const response = await fetch(`${issuer}/.well-known/jwks.json`);

  if (!response.ok) {
    return cached?.keys ?? [];
  }

  const { keys } = (await response.json()) as { keys: SigningKey[] };
  keyCache.set(issuer, { keys, fetched: Date.now() });

  return keys;
}

export async function verifyContext(
  token: string | undefined,
  appId: string,
): Promise<SwellContext | null> {
  const parts = token?.split(".");

  if (!parts || parts.length !== 3) {
    return null;
  }

  const [headerPart, payloadPart, signaturePart] = parts;

  try {
    const header = decodeJson(headerPart);
    const claims = decodeJson(payloadPart);
    const audiences: unknown[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

    if (
      header.alg !== "ES256" ||
      !ISSUERS.includes(claims.iss) ||
      !audiences.includes(appId) ||
      !(claims.exp * 1000 > Date.now())
    ) {
      return null;
    }

    // An unknown key id means the keys were rotated since they were cached
    const jwk =
      (await issuerKeys(claims.iss)).find((key) => key.kid === header.kid) ??
      (await issuerKeys(claims.iss, true)).find((key) => key.kid === header.kid);

    if (!jwk) {
      return null;
    }

    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    // JWS ES256 signatures are raw r||s, the format WebCrypto expects
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      decode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );

    return valid ? (claims as SwellContext) : null;
  } catch {
    return null;
  }
}
