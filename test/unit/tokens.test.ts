import { describe, expect, it } from "vitest";
import { isObjectId, randomToken, safeEqual } from "../../functions/lib/tokens";

describe("randomToken", () => {
  it("is URL-safe and unique", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => randomToken()));

    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    }
  });
});

describe("safeEqual", () => {
  it("compares strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(undefined, "abc")).toBe(false);
  });
});

describe("isObjectId", () => {
  it("accepts 24 hex characters only", () => {
    expect(isObjectId("6ac4f4be5029300011429e1e")).toBe(true);
    expect(isObjectId("6ac4f4be5029300011429e1")).toBe(false);
    expect(isObjectId("../../etc/passwd")).toBe(false);
  });
});
