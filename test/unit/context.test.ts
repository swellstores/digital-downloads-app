import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyContext } from "../../frontend/src/context";

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signingKey(kid: string) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;

  return {
    jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid, alg: "ES256", use: "sig" },
    async sign(claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
      const head = base64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid, ...header }));
      const body = base64url(JSON.stringify(claims));
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        encoder.encode(`${head}.${body}`),
      );
      return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
    },
  };
}

function serveKeys(...keys: Array<{ jwk: object }>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ keys: keys.map((key) => key.jwk) })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://swell.store",
    aud: "digital_downloads",
    exp: Math.floor(Date.now() / 1000) + 60,
    store_id: "swell-apps",
    environment_id: "test",
    app_id: "digital_downloads",
    installation_id: "6ac50d29ddc17800129372ea",
    api_host: "https://api.swell.store",
    admin: { user_id: "60ae67040622c9407a06bdcb" },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyContext", () => {
  it("accepts a context Swell signed for this app", async () => {
    const key = await signingKey("key-1");
    serveKeys(key);

    await expect(verifyContext(await key.sign(claims()), "digital_downloads")).resolves.toMatchObject({
      store_id: "swell-apps",
      admin: { user_id: "60ae67040622c9407a06bdcb" },
    });
  });

  it.each([
    ["another app", { aud: "printful" }],
    ["another issuer", { iss: "https://evil.example" }],
    ["an expired context", { exp: Math.floor(Date.now() / 1000) - 1 }],
  ])("rejects %s", async (_case, overrides) => {
    const key = await signingKey("key-2");
    serveKeys(key);

    await expect(verifyContext(await key.sign(claims(overrides)), "digital_downloads")).resolves.toBeNull();
  });

  it("rejects a context whose claims were changed after signing", async () => {
    const key = await signingKey("key-3");
    serveKeys(key);
    const [head, , signature] = (await key.sign(claims({ admin: null }))).split(".");
    const forged = `${head}.${base64url(JSON.stringify(claims()))}.${signature}`;

    await expect(verifyContext(forged, "digital_downloads")).resolves.toBeNull();
  });

  it("rejects a context signed with a key Swell doesn't publish", async () => {
    const published = await signingKey("key-4");
    const attacker = await signingKey("key-4");
    serveKeys(published);

    await expect(verifyContext(await attacker.sign(claims()), "digital_downloads")).resolves.toBeNull();
  });

  it("refetches the keys when Swell rotates to a new key", async () => {
    const old = await signingKey("key-5");
    serveKeys(old);
    await verifyContext(await old.sign(claims()), "digital_downloads");

    const rotated = await signingKey("key-6");
    const fetchMock = serveKeys(old, rotated);

    await expect(verifyContext(await rotated.sign(claims()), "digital_downloads")).resolves.not.toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("rejects garbage", async () => {
    serveKeys();

    await expect(verifyContext(undefined, "digital_downloads")).resolves.toBeNull();
    await expect(verifyContext("not-a-jwt", "digital_downloads")).resolves.toBeNull();
  });
});
