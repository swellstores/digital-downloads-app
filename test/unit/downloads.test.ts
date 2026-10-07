import { describe, expect, it } from "vitest";
import { get, post } from "../../functions/downloads";
import { createFakeSwell } from "../helpers/fake-swell";
import { PATHS, request, seedGrantedOrder, seedProduct, STORAGE } from "../helpers/fixtures";

const LINK_URL = "https://www.dropbox.com/s/secret-share/presets.zip";

function setup(grantValues: Record<string, any> = {}, orderValues: Record<string, any> = {}) {
  const fake = createFakeSwell({ settings: { storage: STORAGE } });
  const { product, deliverables } = seedProduct(fake, {
    deliverables: [
      { name: "Lightroom presets", source: "link", url: LINK_URL, version: "2.1" },
      { name: "Course videos", source: "bucket", object_key: "digital-downloads/p/abc/videos.zip", filename: "Course videos.zip" },
    ],
  });
  const { order, grant, token } = seedGrantedOrder(fake, product.id, { grant: grantValues, order: orderValues });

  return { fake, order, grant, token, link: deliverables[0], file: deliverables[1] };
}

function click(fake: ReturnType<typeof createFakeSwell>, body: Record<string, any> | string) {
  const req = request(fake, { method: "POST", data: typeof body === "string" ? {} : body });
  if (typeof body === "string") {
    req.body = body;
  }
  return post(req) as Promise<Response>;
}

describe("downloads page", () => {
  it("rejects a wrong token without revealing anything", async () => {
    const { fake, order } = setup();
    const response = (await get(request(fake, { method: "GET", data: { order: order.id, token: "wrong-token-but-long-enough" } }))) as Response;

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("This link isn&#39;t valid");
  });

  it("lists the order's downloads without exposing link destinations", async () => {
    const { fake, order, token, link } = setup({ download_limit: 3, download_counts: {} });
    const response = (await get(request(fake, { method: "GET", data: { order: order.id, token } }))) as Response;
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("Downloads for order 1001");
    expect(html).toContain("Lightroom presets");
    expect(html).toContain("v2.1");
    expect(html).toContain("3 downloads left");
    expect(html).toContain(`value="${link.id}"`);
    expect(html).not.toContain(LINK_URL);
  });

  it("still opens when another app's order write dropped this app's order fields", async () => {
    const { fake, order, token, grant } = setup();
    fake.find(PATHS.grants, grant.id)!.access_token = token;
    delete fake.find("/orders", order.id)!.$app;

    const response = (await get(request(fake, { method: "GET", data: { order: order.id, token } }))) as Response;

    expect(response.status).toBe(200);
  });

  it("doesn't count page views", async () => {
    const { fake, order, token, grant } = setup({ download_limit: 1 });

    await get(request(fake, { method: "GET", data: { order: order.id, token } }));

    expect(fake.find(PATHS.grants, grant.id)!.download_counts).toBeUndefined();
  });
});

describe("download clicks", () => {
  it("counts, logs and redirects a link", async () => {
    const { fake, order, token, grant, link } = setup();
    const response = await click(fake, { order: order.id, token, grant: grant.id, deliverable: link.id });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(LINK_URL);
    expect(fake.find(PATHS.grants, grant.id)!.download_counts).toEqual({ [link.id]: 1 });
    expect(fake.all(PATHS.events)).toMatchObject([
      { grant_id: grant.id, order_id: order.id, deliverable_id: link.id, deliverable_name: "Lightroom presets" },
    ]);
  });

  it("redirects bucket files to a short-lived presigned URL", async () => {
    const { fake, order, token, grant, file } = setup();
    const response = await click(fake, { order: order.id, token, grant: grant.id, deliverable: file.id });
    const location = new URL(response.headers.get("Location")!);

    expect(response.status).toBe(303);
    expect(location.origin + location.pathname).toBe(
      "https://acct.r2.cloudflarestorage.com/downloads/digital-downloads/p/abc/videos.zip",
    );
    expect(location.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(location.searchParams.get("response-content-disposition")).toContain("Course videos.zip");
  });

  it("accepts a raw form-encoded body", async () => {
    const { fake, order, token, grant, link } = setup();
    const body = new URLSearchParams({ order: order.id, token, grant: grant.id, deliverable: link.id }).toString();

    expect((await click(fake, body)).status).toBe(303);
  });

  it("stops at the download limit", async () => {
    const { fake, order, token, grant, link } = setup({ download_limit: 2 });

    for (let i = 0; i < 2; i++) {
      expect((await click(fake, { order: order.id, token, grant: grant.id, deliverable: link.id })).status).toBe(303);
    }

    const response = await click(fake, { order: order.id, token, grant: grant.id, deliverable: link.id });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("You&#39;ve used all the downloads for this item.");
    expect(fake.find(PATHS.grants, grant.id)!.download_counts[link.id]).toBe(2);
  });

  it.each([
    [{ status: "revoked" }, {}, "Access to this purchase has been removed."],
    [{ date_expires: "2020-01-01T00:00:00.000Z" }, {}, "Your download period has ended."],
    [{}, { refunded: true }, "This order was refunded."],
  ])("refuses grant %o on order %o", async (grantValues, orderValues, message) => {
    const { fake, order, token, grant, link } = setup(grantValues, orderValues);
    const response = await click(fake, { order: order.id, token, grant: grant.id, deliverable: link.id });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain(message.replace("'", "&#39;"));
    expect(fake.all(PATHS.events)).toHaveLength(0);
  });

  it("won't use another order's grant with this order's token", async () => {
    const { fake, token, order, link } = setup();
    const other = seedGrantedOrder(fake, link.parent_id);
    const response = await click(fake, { order: order.id, token, grant: other.grant.id, deliverable: link.id });

    expect(response.status).toBe(404);
  });

  it("won't redirect to a link that isn't https", async () => {
    const { fake, order, token, grant, link } = setup();
    fake.find(PATHS.deliverables, link.id)!.url = "javascript:alert(1)";

    const response = await click(fake, { order: order.id, token, grant: grant.id, deliverable: link.id });

    expect(response.status).toBe(503);
    expect(response.headers.get("Location")).toBeNull();
  });
});
