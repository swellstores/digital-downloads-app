import { describe, expect, it } from "vitest";
import { get as accountDownloads } from "../../functions/account-downloads";
import notifySweep from "../../functions/notify-sweep";
import { APP_ID, createFakeSwell } from "../helpers/fake-swell";
import { PATHS, request, seedGrantedOrder, seedProduct } from "../helpers/fixtures";

describe("notify-sweep", () => {
  function seedBuyers(fake: ReturnType<typeof createFakeSwell>, productId: string, count: number) {
    return Array.from({ length: count }, () => {
      const { order, grant } = seedGrantedOrder(fake, productId, { grant: { download_counts: { x: 2 } } });
      fake.find("/orders", order.id)!.$app[APP_ID].downloads_url = `https://example.com/d/${order.id}`;
      return { order, grant };
    });
  }

  it("emails each buyer with active access once, from their grant, and resets counts", async () => {
    const fake = createFakeSwell();
    const { product } = seedProduct(fake, { name: "Presets", deliverables: [{ name: "Pack", url: "https://example.com/p" }] });
    const buyers = seedBuyers(fake, product.id, 30);
    const revoked = seedGrantedOrder(fake, product.id, { grant: { status: "revoked" } });
    const job = fake.seed(PATHS.jobs, { product_id: product.id, message: "v2 is out", reset_counts: true, status: "pending", sent_count: 0 });

    await notifySweep(request(fake));

    expect(fake.find(PATHS.jobs, job.id)).toMatchObject({ status: "done", sent_count: 30 });

    const emailed = fake.notifications.map((note) => note.path);
    expect(new Set(emailed).size).toBe(30);
    expect(emailed.every((path) => path.startsWith(`${PATHS.grants}/`))).toBe(true);
    expect(emailed).not.toContain(`${PATHS.grants}/${revoked.grant.id}`);
    expect(fake.notifications[0]).toMatchObject({
      id: `${APP_ID}.file-updated`,
      data: { product_name: "Presets", message: "v2 is out", downloads_url: `https://example.com/d/${buyers[0].order.id}` },
    });

    for (const { grant } of buyers) {
      expect(fake.find(PATHS.grants, grant.id)).toMatchObject({ download_counts: {}, date_update_notified: expect.any(String) });
    }
  });

  it("works through large lists over several runs without emailing anyone twice", async () => {
    const fake = createFakeSwell();
    const { product } = seedProduct(fake, { name: "Presets" });
    seedBuyers(fake, product.id, 120);
    const job = fake.seed(PATHS.jobs, { product_id: product.id, status: "pending", sent_count: 0 });

    await notifySweep(request(fake));
    expect(fake.find(PATHS.jobs, job.id)).toMatchObject({ status: "pending", sent_count: 100 });

    await notifySweep(request(fake));
    expect(fake.find(PATHS.jobs, job.id)).toMatchObject({ status: "done", sent_count: 120 });

    const emailed = fake.notifications.map((note) => note.path);
    expect(emailed).toHaveLength(120);
    expect(new Set(emailed).size).toBe(120);
  });

  it("does nothing without a pending job", async () => {
    const fake = createFakeSwell();

    await notifySweep(request(fake));

    expect(fake.notifications).toHaveLength(0);
  });
});

describe("account-downloads", () => {
  it("needs a signed-in customer", async () => {
    await expect(accountDownloads(request(createFakeSwell(), { method: "GET" }))).rejects.toMatchObject({ status: 401 });
  });

  it("lists only the customer's own orders, newest first, with keys and links", async () => {
    const fake = createFakeSwell();
    const { product } = seedProduct(fake, { deliverables: [{ name: "Ebook", url: "https://example.com/e" }] });
    const mine = seedGrantedOrder(fake, product.id);
    fake.find("/orders", mine.order.id)!.$app[APP_ID].downloads_url = "https://example.com/mine";
    fake.seed(PATHS.keys, { key: "MY-KEY", product_id: product.id, source: "generated", status: "assigned", grant_id: mine.grant.id, order_id: mine.order.id });
    seedGrantedOrder(fake, product.id);

    const result = await accountDownloads(
      request(fake, { method: "GET", session: { account_id: mine.order.account_id } }),
    );

    expect(result).toMatchObject({
      orders: [
        {
          id: mine.order.id,
          downloads_url: "https://example.com/mine",
          items: [
            {
              product_name: "Photo Course",
              status: "active",
              deliverables: [{ name: "Ebook", downloads_left: null }],
              license_keys: [{ key: "MY-KEY", status: "assigned" }],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("https://example.com/e");
  });
});
