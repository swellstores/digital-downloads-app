import { describe, expect, it } from "vitest";
import { post as licenseApi } from "../../functions/license-api";
import licenseGuard from "../../functions/license-guard";
import productActions from "../../functions/product-actions";
import { createFakeSwell, objectId } from "../helpers/fake-swell";
import { PATHS, request, seedProduct } from "../helpers/fixtures";

describe("license-api", () => {
  function setup(keyValues: Record<string, any> = {}, grantStatus = "active") {
    const fake = createFakeSwell();
    const grant = fake.seed(PATHS.grants, { order_id: objectId(), item_id: objectId(), product_id: objectId(), status: grantStatus });
    fake.seed(PATHS.keys, {
      key: "ABCDE-FGHJK-LMNPQ-RSTUV",
      product_id: grant.product_id,
      source: "generated",
      status: "assigned",
      grant_id: grant.id,
      activation_limit: 2,
      activations: [],
      ...keyValues,
    });
    return fake;
  }

  async function call(fake: ReturnType<typeof createFakeSwell>, body: Record<string, any>) {
    const result = await licenseApi(request(fake, { data: body }));
    // `status` in the body is the key's status, so the HTTP status goes under `http`
    return result instanceof Response ? { http: result.status, ...(await result.json()) } : { http: 200, ...result };
  }

  it("validates an assigned key", async () => {
    const result = await call(setup(), { action: "validate", key: " ABCDE-FGHJK-LMNPQ-RSTUV " });

    expect(result).toMatchObject({ http: 200, valid: true, activations_used: 0, activation_limit: 2 });
  });

  it("activates up to the limit, and activating the same instance again is a no-op", async () => {
    const fake = setup();
    const key = "ABCDE-FGHJK-LMNPQ-RSTUV";

    expect(await call(fake, { action: "activate", key, instance_id: "laptop" })).toMatchObject({ activated: true, activations_used: 1 });
    expect(await call(fake, { action: "activate", key, instance_id: "laptop" })).toMatchObject({ activated: true, activations_used: 1 });
    expect(await call(fake, { action: "activate", key, instance_id: "desktop" })).toMatchObject({ activations_used: 2 });
    expect(await call(fake, { action: "activate", key, instance_id: "tablet" })).toMatchObject({
      http: 409,
      valid: false,
      error: "activation_limit",
    });

    expect(await call(fake, { action: "deactivate", key, instance_id: "laptop" })).toMatchObject({ activated: false, activations_used: 1 });
    expect(await call(fake, { action: "activate", key, instance_id: "tablet" })).toMatchObject({ activated: true, activations_used: 2 });
  });

  it.each([
    [{ status: "revoked" }, "active", "revoked"],
    [{ date_expires: "2020-01-01T00:00:00.000Z" }, "active", "expired"],
    [{}, "suspended", "suspended"],
  ])("reports key %o with grant %s as %s", async (keyValues, grantStatus, status) => {
    const fake = setup(keyValues, grantStatus);
    const key = "ABCDE-FGHJK-LMNPQ-RSTUV";

    expect(await call(fake, { action: "validate", key })).toMatchObject({ valid: false, status });
    expect(await call(fake, { action: "activate", key, instance_id: "x" })).toMatchObject({ http: 403, error: status });
  });

  it("doesn't reveal unsold pool keys", async () => {
    const fake = setup({ status: "available" });

    expect(await call(fake, { action: "validate", key: "ABCDE-FGHJK-LMNPQ-RSTUV" })).toMatchObject({ http: 404, error: "not_found" });
  });

  it("checks its input", async () => {
    const fake = setup();

    expect(await call(fake, { action: "delete", key: "x" })).toMatchObject({ http: 400, error: "invalid_action" });
    expect(await call(fake, { action: "validate" })).toMatchObject({ http: 400, error: "invalid_key" });
    expect(await call(fake, { action: "activate", key: "ABCDE-FGHJK-LMNPQ-RSTUV" })).toMatchObject({
      http: 400,
      error: "instance_id_required",
    });
  });
});

describe("license-guard", () => {
  function setup(available: number) {
    const fake = createFakeSwell();
    const { product } = seedProduct(fake, { name: "Pro Plugin", app: { license_enabled: true, license_source: "pool" } });
    for (let i = 0; i < available; i++) {
      fake.seed(PATHS.keys, { key: `K${i}`, product_id: product.id, source: "pool", status: "available", claims: 0 });
    }
    return { fake, product };
  }

  it("stops an order the pool can't cover", async () => {
    const { fake, product } = setup(1);
    const req = request(fake, { data: { items: [{ product_id: product.id, quantity: 2 }], $event: { type: "order.created", hook: "before" } } });

    await expect(licenseGuard(req)).rejects.toMatchObject({
      name: "SwellRejection",
      code: "license_keys_sold_out",
      status: 409,
      message: "Only 1 of Pro Plugin left.",
    });
  });

  it("lets covered orders, other products and renewals through", async () => {
    const { fake, product } = setup(2);
    const other = fake.seed("/products", { name: "Poster" });

    await expect(licenseGuard(request(fake, { data: { items: [{ product_id: product.id, quantity: 2 }] } }))).resolves.toBeUndefined();
    await expect(licenseGuard(request(fake, { data: { items: [{ product_id: other.id, quantity: 9 }] } }))).resolves.toBeUndefined();
    await expect(
      licenseGuard(request(fake, { data: { subscription_id: objectId(), items: [{ product_id: product.id, quantity: 9 }] } })),
    ).resolves.toBeUndefined();
  });
});

describe("product actions", () => {
  function importKeys(fake: ReturnType<typeof createFakeSwell>, productId: string, keys: string) {
    return productActions(
      request(fake, {
        data: { keys, $action: { id: "import_keys", source: "record", collection: "products", record_id: productId, user_id: "u1" } },
      }),
    );
  }

  it("imports pool keys, skipping blanks, repeats and keys already in the app", async () => {
    const fake = createFakeSwell();
    const { product } = seedProduct(fake);
    fake.seed(PATHS.keys, { key: "EXISTING", product_id: objectId(), source: "pool", status: "assigned" });

    await expect(importKeys(fake, product.id, "AAA\n\nBBB\r\nAAA, EXISTING")).resolves.toEqual({
      message: "Imported 2 keys; skipped 1 that already exist. 2 available to sell.",
    });
    expect(fake.all(PATHS.keys).filter((key) => key.product_id === product.id).map((key) => key.key)).toEqual(["AAA", "BBB"]);
  });

  it("queues update emails", async () => {
    const fake = createFakeSwell();
    const { product } = seedProduct(fake);

    await productActions(
      request(fake, {
        data: {
          message: "  New presets  ",
          reset_counts: true,
          $action: { id: "notify_buyers", source: "record", collection: "products", record_id: product.id, user_id: "u1" },
        },
      }),
    );

    expect(fake.all(PATHS.jobs)).toMatchObject([
      { product_id: product.id, message: "New presets", reset_counts: true, status: "pending" },
    ]);
  });
});
