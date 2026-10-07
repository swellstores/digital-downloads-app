import { describe, expect, it } from "vitest";
import orderActions from "../../functions/order-actions";
import revokeAccess from "../../functions/revoke-access";
import subscriptionAccess from "../../functions/subscription-access";
import { APP_ID, createFakeSwell, objectId } from "../helpers/fake-swell";
import { PATHS, request, seedGrantedOrder, seedProduct } from "../helpers/fixtures";

function setup(grantValues: Record<string, any> = {}) {
  const fake = createFakeSwell({ settings: {} });
  const { product } = seedProduct(fake, {
    app: { license_enabled: true },
    deliverables: [{ name: "Ebook", url: "https://example.com/ebook.pdf" }],
  });
  const { order, grant } = seedGrantedOrder(fake, product.id, { grant: grantValues });
  const key = fake.seed(PATHS.keys, {
    key: "KEY-1",
    product_id: product.id,
    source: "generated",
    status: "assigned",
    grant_id: grant.id,
    order_id: order.id,
  });

  return { fake, product, order, grant, key };
}

function action(fake: ReturnType<typeof createFakeSwell>, id: string, recordId: string, fields = {}) {
  return orderActions(
    request(fake, {
      data: { ...fields, $action: { id, source: "record", collection: "orders", record_id: recordId, user_id: "u1" } },
    }),
  );
}

describe("revoke-access", () => {
  it("revokes grants and keys when an order is refunded", async () => {
    const { fake, order, grant, key } = setup();

    await revokeAccess(request(fake, { data: { id: order.id, $event: { type: "order.refunded" } } }));

    expect(fake.find(PATHS.grants, grant.id)).toMatchObject({ status: "revoked", reason: "refunded" });
    expect(fake.find(PATHS.keys, key.id)!.status).toBe("revoked");
    expect(fake.find("/orders", order.id)!.$app[APP_ID].access_status).toBe("revoked");
  });

  it("leaves orders without digital access alone", async () => {
    const fake = createFakeSwell();
    const order = fake.seed("/orders", { number: "1" });

    await revokeAccess(request(fake, { data: { id: order.id, $event: { type: "order.canceled" } } }));

    expect(fake.find("/orders", order.id)!.$app).toBeUndefined();
  });
});

describe("subscription-access", () => {
  it("pauses access while the subscription is paused and restores it with the new period", async () => {
    const subscriptionId = objectId();
    const { fake, grant, key } = setup({ subscription_id: subscriptionId });
    fake.find(PATHS.keys, key.id)!.subscription_id = subscriptionId;
    fake.seed("/subscriptions", { id: subscriptionId, date_period_end: "2026-12-01T00:00:00.000Z" });

    await subscriptionAccess(request(fake, { data: { id: subscriptionId, $event: { type: "subscription.paused" } } }));
    expect(fake.find(PATHS.grants, grant.id)).toMatchObject({ status: "suspended", reason: "subscription_paused" });

    await subscriptionAccess(request(fake, { data: { id: subscriptionId, $event: { type: "subscription.resumed" } } }));
    expect(fake.find(PATHS.grants, grant.id)).toMatchObject({ status: "active", reason: null });
    expect(fake.find(PATHS.keys, key.id)!.date_expires).toBe("2026-12-01T00:00:00.000Z");
  });

  it("doesn't restore access an admin revoked", async () => {
    const subscriptionId = objectId();
    const { fake, grant } = setup({ subscription_id: subscriptionId, status: "revoked" });
    fake.seed("/subscriptions", { id: subscriptionId });

    await subscriptionAccess(request(fake, { data: { id: subscriptionId, $event: { type: "subscription.paid" } } }));

    expect(fake.find(PATHS.grants, grant.id)!.status).toBe("revoked");
  });
});

describe("order actions", () => {
  it("revokes and restores access together with license keys", async () => {
    const { fake, order, grant, key } = setup();

    await expect(action(fake, "revoke_access", order.id)).resolves.toEqual({
      message: "Access and license keys revoked.",
    });
    expect(fake.find(PATHS.keys, key.id)!.status).toBe("revoked");

    await action(fake, "restore_access", order.id);
    expect(fake.find(PATHS.grants, grant.id)).toMatchObject({ status: "active", reason: null });
    expect(fake.find(PATHS.keys, key.id)!.status).toBe("assigned");
    expect(fake.find("/orders", order.id)!.$app[APP_ID].access_status).toBe("granted");
  });

  it("resets download counts", async () => {
    const { fake, order, grant } = setup({ download_counts: { abc: 3 } });

    await action(fake, "reset_counts", order.id);

    expect(fake.find(PATHS.grants, grant.id)!.download_counts).toEqual({});
  });

  it("extends expired access from today", async () => {
    const { fake, order, grant } = setup({ date_expires: "2020-01-01T00:00:00.000Z" });

    await action(fake, "extend_access", order.id, { days: 10 });

    const expires = new Date(fake.find(PATHS.grants, grant.id)!.date_expires).getTime();
    expect(expires).toBeGreaterThan(Date.now() + 9 * 86_400_000);
    expect(expires).toBeLessThan(Date.now() + 11 * 86_400_000);
  });

  it("rejects a nonsense number of days", async () => {
    const { fake, order } = setup({ date_expires: "2030-01-01T00:00:00.000Z" });

    await expect(action(fake, "extend_access", order.id, { days: "lots" })).rejects.toMatchObject({ status: 400 });
  });

  it("resends the downloads email", async () => {
    const { fake, order } = setup();
    fake.find("/orders", order.id)!.$app[APP_ID].downloads_url = "https://example.com/d";

    await expect(action(fake, "resend_email", order.id)).resolves.toEqual({ message: "Downloads email sent." });
    expect(fake.notifications.map((note) => note.id)).toEqual([`${APP_ID}.downloads-ready`]);
  });

  it("won't grant an unpaid order", async () => {
    const { fake, order } = setup();
    fake.find("/orders", order.id)!.paid = false;

    await expect(action(fake, "resend_email", order.id)).rejects.toMatchObject({ status: 400 });
  });

  it("checks the record id before using it", async () => {
    const fake = createFakeSwell();

    await expect(action(fake, "revoke_access", "../products")).rejects.toMatchObject({ status: 400 });
  });
});

describe("resending after a revoke", () => {
  it("keeps the order revoked and refuses to email", async () => {
    const { fake, order } = setup();

    await action(fake, "revoke_access", order.id);
    await expect(action(fake, "resend_email", order.id)).rejects.toMatchObject({ status: 400 });

    expect(fake.find("/orders", order.id)!.$app[APP_ID].access_status).toBe("revoked");
    expect(fake.notifications).toHaveLength(0);
  });
});
