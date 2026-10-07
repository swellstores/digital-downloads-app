import { describe, expect, it } from "vitest";
import grantAccess from "../../functions/grant-access";
import { APP_ID, APP_OBJECT_ID, createFakeSwell, objectId } from "../helpers/fake-swell";
import { PATHS, request, seedOrder, seedProduct } from "../helpers/fixtures";

const SETTINGS = { delivery: { download_limit: 5, access_days: 30 } };

function setup(productValues: Parameters<typeof seedProduct>[1] = {}) {
  const fake = createFakeSwell({ settings: SETTINGS });
  const { product, deliverables } = seedProduct(fake, {
    deliverables: [{ name: "Ebook", url: "https://example.com/ebook.pdf" }],
    ...productValues,
  });

  return { fake, product, deliverables };
}

function paid(fake: ReturnType<typeof createFakeSwell>, order: { id: string }, type = "order.paid", extra = {}) {
  return grantAccess(request(fake, { data: { ...order, ...extra, $event: { type } } }));
}

describe("grant-access", () => {
  it("grants a paid order's digital items, writes its link and emails the buyer", async () => {
    const { fake, product } = setup({
      app: { license_enabled: true, license_source: "generate", download_limit: 3 },
    });
    const physical = fake.seed("/products", { name: "Poster", type: "standard" });
    const order = seedOrder(fake, [{ product_id: product.id }, { product_id: physical.id }]);

    await paid(fake, order);

    const [grant, ...others] = fake.all(PATHS.grants);
    expect(others).toHaveLength(0);
    expect(grant).toMatchObject({
      order_id: order.id,
      item_id: order.items[0].id,
      product_id: product.id,
      status: "active",
      download_limit: 3,
      subscription_id: null,
    });
    expect(new Date(grant.date_expires).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const access = fake.find("/orders", order.id)!.$app[APP_ID];
    expect(access.access_status).toBe("granted");
    expect(access.access_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(fake.find(PATHS.grants, grant.id)!.access_token).toBe(access.access_token);
    expect(access.downloads_url).toBe(
      `https://test-store.swell.store/functions/${APP_OBJECT_ID}/downloads?order=${order.id}&token=${access.access_token}`,
    );
    expect(access.date_notified).toBeTruthy();

    expect(fake.notifications).toHaveLength(1);
    expect(fake.notifications[0]).toMatchObject({
      path: `/orders/${order.id}`,
      id: `${APP_ID}.downloads-ready`,
      data: {
        downloads_url: access.downloads_url,
        downloads: [
          {
            product_name: "Photo Course",
            deliverables: [{ name: "Ebook", version: null }],
            license_keys: [expect.stringMatching(/^\w{5}-\w{5}-\w{5}-\w{5}$/)],
          },
        ],
      },
    });
  });

  it("keeps the grants' token when the order's copy was lost", async () => {
    const { fake, product } = setup();
    const order = seedOrder(fake, [{ product_id: product.id }]);

    await paid(fake, order);
    const token = fake.all(PATHS.grants)[0].access_token;
    delete fake.find("/orders", order.id)!.$app;
    await paid(fake, order);

    expect(fake.find("/orders", order.id)!.$app[APP_ID].access_token).toBe(token);
  });

  it("uses the app defaults when the product doesn't override them", async () => {
    const { fake, product } = setup();
    const order = seedOrder(fake, [{ product_id: product.id }]);

    await paid(fake, order);

    expect(fake.all(PATHS.grants)[0].download_limit).toBe(5);
  });

  it("does nothing for orders without digital items", async () => {
    const fake = createFakeSwell({ settings: SETTINGS });
    const poster = fake.seed("/products", { name: "Poster" });
    const order = seedOrder(fake, [{ product_id: poster.id }]);

    await paid(fake, order);

    expect(fake.all(PATHS.grants)).toHaveLength(0);
    expect(fake.notifications).toHaveLength(0);
  });

  it("handles submitted orders only when they're free", async () => {
    const { fake, product } = setup();
    const charged = seedOrder(fake, [{ product_id: product.id }], { paid: false, grand_total: 49 });
    const free = seedOrder(fake, [{ product_id: product.id }], { paid: false, grand_total: 0 });

    await paid(fake, charged, "order.submitted", { grand_total: 49 });
    await paid(fake, free, "order.submitted", { grand_total: 0 });

    expect(fake.all(PATHS.grants).map((grant) => grant.order_id)).toEqual([free.id]);
  });

  it("sends one email when an event is delivered twice", async () => {
    const { fake, product } = setup();
    const order = seedOrder(fake, [{ product_id: product.id }]);

    await paid(fake, order);
    await paid(fake, order);

    expect(fake.all(PATHS.grants)).toHaveLength(1);
    expect(fake.notifications).toHaveLength(1);
  });

  it("ties subscription access to the subscription and skips renewal orders", async () => {
    const { fake, product } = setup({ type: "subscription" });
    const first = seedOrder(fake, [{ product_id: product.id }]);
    const subscription = fake.seed("/subscriptions", {
      order_id: first.id,
      order_item_id: first.items[0].id,
      product_id: product.id,
      date_period_end: "2026-11-06T00:00:00.000Z",
    });

    await paid(fake, first);

    const renewal = seedOrder(fake, [{ product_id: product.id }], { subscription_id: subscription.id });
    await paid(fake, renewal);

    expect(fake.all(PATHS.grants)).toMatchObject([
      { order_id: first.id, subscription_id: subscription.id, date_expires: null },
    ]);
  });

  it("ignores canceled orders", async () => {
    const { fake, product } = setup();
    const order = seedOrder(fake, [{ product_id: product.id }], { canceled: true });

    await paid(fake, order);

    expect(fake.all(PATHS.grants)).toHaveLength(0);
  });

  it("tells admins when a key pool runs out mid-order", async () => {
    const { fake, product } = setup({
      app: { license_enabled: true, license_source: "pool" },
    });
    fake.seed(PATHS.keys, { key: "ONLY-ONE", product_id: product.id, source: "pool", status: "available", claims: 0 });
    const order = seedOrder(fake, [{ product_id: product.id, quantity: 2 }], { number: "1042" });

    await paid(fake, order);

    expect(fake.find("/orders", order.id)!.$app[APP_ID].keys_missing).toBe(1);
    expect(fake.notifications.map((note) => note.id)).toEqual([
      `${APP_ID}.license-keys-low`,
      `${APP_ID}.downloads-ready`,
    ]);
    expect(fake.notifications[0]).toMatchObject({
      path: `/products/${product.id}`,
      data: { available: 0, missing: 1, order_number: "1042" },
    });
  });

  it("gives concurrent items of one pool product different keys", async () => {
    const { fake, product } = setup({ app: { license_enabled: true, license_source: "pool" } });
    for (const key of ["A", "B", "C"]) {
      fake.seed(PATHS.keys, { key, product_id: product.id, source: "pool", status: "available", claims: 0 });
    }
    const order = seedOrder(fake, [{ product_id: product.id }, { product_id: product.id }]);

    await paid(fake, order);

    const assigned = fake.all(PATHS.keys).filter((key) => key.status === "assigned");
    expect(assigned).toHaveLength(2);
    expect(new Set(assigned.map((key) => key.grant_id)).size).toBe(2);
  });

  it("warns admins once when a sale takes the pool to the warning level", async () => {
    const fake = createFakeSwell({ settings: { ...SETTINGS, licenses: { low_stock_threshold: 1 } } });
    const { product } = seedProduct(fake, { app: { license_enabled: true, license_source: "pool" } });
    for (const key of ["A", "B", "C"]) {
      fake.seed(PATHS.keys, { key, product_id: product.id, source: "pool", status: "available", claims: 0 });
    }

    for (let i = 0; i < 3; i++) {
      await paid(fake, seedOrder(fake, [{ product_id: product.id }]));
    }

    const warnings = fake.notifications.filter((note) => note.id === `${APP_ID}.license-keys-low`);
    expect(warnings.map((note) => note.data!.available)).toEqual([1]);
  });

  it("gives deliverables to the variant they belong to", async () => {
    const blue = objectId();
    const { fake, product } = setup({
      deliverables: [
        { name: "Everyone gets this", url: "https://example.com/a" },
        { name: "Blue bonus", url: "https://example.com/b", variant_id: blue },
      ],
    });
    const order = seedOrder(fake, [{ product_id: product.id, variant_id: objectId() }]);

    await paid(fake, order);

    expect(fake.notifications[0].data!.downloads[0].deliverables).toEqual([
      { name: "Everyone gets this", version: null },
    ]);
  });
});

describe("settings defaults", () => {
  it("warns at 10 keys when the store never saved the setting", async () => {
    const fake = createFakeSwell({ settings: {} });
    const { product } = seedProduct(fake, { app: { license_enabled: true, license_source: "pool" } });
    for (let i = 0; i < 11; i++) {
      fake.seed(PATHS.keys, { key: `K${i}`, product_id: product.id, source: "pool", status: "available", claims: 0 });
    }

    await grantAccess(request(fake, { data: { ...seedOrder(fake, [{ product_id: product.id }]), $event: { type: "order.paid" } } }));

    expect(fake.notifications.filter((note) => note.id === `${APP_ID}.license-keys-low`)).toMatchObject([
      { data: { available: 10 } },
    ]);
  });
});
