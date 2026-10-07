import { describe, expect, it } from "vitest";
import {
  addDays,
  deliverablesForVariant,
  downloadDenial,
  downloadsLeft,
  grantDenial,
  isSafeLink,
  toArray,
} from "../../functions/lib/access";
import type { Deliverable, Grant } from "../../functions/lib/types";

function grant(overrides: Partial<Grant> = {}): Grant {
  return { id: "g1", order_id: "o1", item_id: "i1", product_id: "p1", status: "active", ...overrides };
}

const NOW = new Date("2026-10-06T12:00:00Z");

describe("deliverablesForVariant", () => {
  const deliverables: Deliverable[] = [
    { id: "a", name: "Everyone" },
    { id: "b", name: "Blue only", variant_id: "blue" },
  ];

  it("gives deliverables without a variant to every variant", () => {
    expect(deliverablesForVariant(deliverables, "red").map((d) => d.id)).toEqual(["a"]);
  });

  it("adds a variant's own deliverables", () => {
    expect(deliverablesForVariant(deliverables, "blue").map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("leaves out variant deliverables for items without a variant", () => {
    expect(deliverablesForVariant(deliverables, null).map((d) => d.id)).toEqual(["a"]);
  });
});

describe("grantDenial", () => {
  it("allows an active, unexpired grant on a paid order", () => {
    expect(grantDenial(grant(), {}, NOW)).toBeNull();
  });

  it.each([
    [{ status: "revoked" as const }, {}, "revoked"],
    [{ status: "suspended" as const }, {}, "suspended"],
    [{}, { canceled: true }, "canceled"],
    [{}, { refunded: true }, "refunded"],
    [{ date_expires: "2026-10-01T00:00:00Z" }, {}, "expired"],
  ])("denies %o on order %o as %s", (overrides, order, reason) => {
    expect(grantDenial(grant(overrides), order, NOW)).toBe(reason);
  });

  it("reports a revoked grant as revoked even when it has also expired", () => {
    expect(
      grantDenial(grant({ status: "revoked", date_expires: "2020-01-01T00:00:00Z" }), {}, NOW),
    ).toBe("revoked");
  });
});

describe("download limits", () => {
  it("is unlimited without a limit", () => {
    expect(downloadsLeft(grant({ download_counts: { a: 50 } }), "a")).toBeNull();
  });

  it("counts each deliverable separately", () => {
    const limited = grant({ download_limit: 3, download_counts: { a: 3, b: 1 } });

    expect(downloadsLeft(limited, "a")).toBe(0);
    expect(downloadsLeft(limited, "b")).toBe(2);
    expect(downloadsLeft(limited, "c")).toBe(3);
    expect(downloadDenial(limited, {}, "a", NOW)).toBe("limit");
    expect(downloadDenial(limited, {}, "b", NOW)).toBeNull();
  });
});

describe("isSafeLink", () => {
  it("accepts https links only", () => {
    expect(isSafeLink("https://www.dropbox.com/s/abc/file.zip")).toBe(true);
    expect(isSafeLink("http://example.com/file.zip")).toBe(false);
    expect(isSafeLink("javascript:alert(1)")).toBe(false);
    expect(isSafeLink("not a url")).toBe(false);
    expect(isSafeLink(null)).toBe(false);
  });
});

describe("helpers", () => {
  it("reads child collections as arrays or pages", () => {
    expect(toArray([1, 2])).toEqual([1, 2]);
    expect(toArray({ results: [3] })).toEqual([3]);
    expect(toArray(undefined)).toEqual([]);
  });

  it("adds days, or returns null for no limit", () => {
    expect(addDays(NOW, 2)).toBe("2026-10-08T12:00:00.000Z");
    expect(addDays(NOW, null)).toBeNull();
  });
});
