import { describe, expect, it } from "vitest";
import { DEFAULT_PATTERN, generateKey, issueKeys } from "../../functions/lib/licenses";
import type { DigitalConfig, Grant } from "../../functions/lib/types";
import { createFakeSwell, objectId } from "../helpers/fake-swell";
import { PATHS, request } from "../helpers/fixtures";

const ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789-]+$/;

describe("generateKey", () => {
  it("fills the default pattern with unambiguous characters", () => {
    const key = generateKey();

    expect(key).toHaveLength(DEFAULT_PATTERN.length);
    expect(key).toMatch(/^\w{5}-\w{5}-\w{5}-\w{5}$/);
    expect(key).toMatch(ALPHABET);
  });

  it("uses a custom pattern with enough random characters", () => {
    expect(generateKey("PRO-XXXXXXXX-XXXXXXXX")).toMatch(/^PRO-\w{8}-\w{8}$/);
  });

  it("falls back to the default when a pattern is guessable", () => {
    expect(generateKey("XXXX-XXXX")).toHaveLength(DEFAULT_PATTERN.length);
  });
});

function setup() {
  const fake = createFakeSwell();
  const req = request(fake);
  const productId = objectId();
  const grant: Grant = {
    id: objectId(),
    order_id: objectId(),
    item_id: objectId(),
    account_id: objectId(),
    product_id: productId,
    variant_id: null,
    status: "active",
  };

  return { fake, req, productId, grant };
}

const GENERATE: DigitalConfig = {
  deliverables: [],
  license_enabled: true,
  license_source: "generate",
  license_activation_limit: 2,
  license_valid_days: 365,
};

describe("issueKeys", () => {
  it("generates one key per unit bought", async () => {
    const { fake, req, grant } = setup();

    await expect(issueKeys(req, grant, GENERATE, 2)).resolves.toEqual({ issued: 2, missing: 0 });

    const keys = fake.all(PATHS.keys);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatchObject({
      status: "assigned",
      source: "generated",
      grant_id: grant.id,
      order_id: grant.order_id,
      activation_limit: 2,
    });
    expect(new Date(keys[0].date_expires).getTime()).toBeGreaterThan(Date.now() + 364 * 86_400_000);
  });

  it("only tops up to quantity when run again", async () => {
    const { fake, req, grant } = setup();

    await issueKeys(req, grant, GENERATE, 2);
    await expect(issueKeys(req, grant, GENERATE, 2)).resolves.toEqual({ issued: 0, missing: 0 });
    expect(fake.all(PATHS.keys)).toHaveLength(2);
  });

  it("hands out pool keys and reports what's missing when the pool runs out", async () => {
    const { fake, req, grant, productId } = setup();
    const pool = { ...GENERATE, license_source: "pool" as const };

    fake.seed(PATHS.keys, { key: "AAA", product_id: productId, source: "pool", status: "available", claims: 0 });
    fake.seed(PATHS.keys, { key: "BBB", product_id: productId, source: "pool", status: "available", claims: 0 });

    await expect(issueKeys(req, grant, pool, 3)).resolves.toEqual({ issued: 2, missing: 1 });
    expect(fake.all(PATHS.keys).map((key) => [key.key, key.status, key.grant_id])).toEqual([
      ["AAA", "assigned", grant.id],
      ["BBB", "assigned", grant.id],
    ]);
  });

  it("skips a pool key another order claimed first", async () => {
    const { fake, req, grant, productId } = setup();
    const pool = { ...GENERATE, license_source: "pool" as const };
    const contested = fake.seed(PATHS.keys, { key: "AAA", product_id: productId, source: "pool", status: "available", claims: 0 });
    fake.seed(PATHS.keys, { key: "BBB", product_id: productId, source: "pool", status: "available", claims: 0 });

    // Another order's claim lands between our read and our $inc
    const put = req.swell.put;
    req.swell.put = async (url: string, data: any) => {
      if (url.endsWith(contested.id) && data.$inc) {
        fake.find(PATHS.keys, contested.id)!.claims = 1;
      }
      return put(url, data);
    };

    await expect(issueKeys(req, grant, pool, 1)).resolves.toEqual({ issued: 1, missing: 0 });
    expect(fake.find(PATHS.keys, contested.id)).toMatchObject({ status: "available", claims: 2 });
    expect(fake.all(PATHS.keys).find((key) => key.key === "BBB")).toMatchObject({ status: "assigned" });
  });

  it("uses a variant's own pool keys or keys for any variant, never another variant's", async () => {
    const { fake, req, grant, productId } = setup();
    const pool = { ...GENERATE, license_source: "pool" as const };

    fake.seed(PATHS.keys, { key: "BLUE", product_id: productId, variant_id: "blue", source: "pool", status: "available", claims: 0 });
    fake.seed(PATHS.keys, { key: "ANY", product_id: productId, source: "pool", status: "available", claims: 0 });

    await issueKeys(req, { ...grant, variant_id: "red" }, pool, 2);

    expect(fake.all(PATHS.keys).map((key) => [key.key, key.status])).toEqual([
      ["BLUE", "available"],
      ["ANY", "assigned"],
    ]);
  });

  it("makes subscription keys expire with the paid period", async () => {
    const { fake, req, grant } = setup();
    const subscription = { id: objectId(), date_period_end: "2026-11-06T00:00:00.000Z" };

    await issueKeys(req, grant, GENERATE, 1, subscription);

    expect(fake.all(PATHS.keys)[0]).toMatchObject({
      subscription_id: subscription.id,
      date_expires: subscription.date_period_end,
    });
  });
});
