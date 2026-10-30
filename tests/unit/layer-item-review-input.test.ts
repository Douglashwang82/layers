import { describe, expect, it } from "vitest";
import {
  decodeReviewCursor,
  encodeReviewCursor,
  layerItemReviewDeleteInput,
  layerItemReviewInput,
} from "../../packages/shared/src";

describe("layerItemReviewInput", () => {
  it("accepts stars only, comment only, or both", () => {
    expect(
      layerItemReviewInput.parse({ stars: 4, expectedRevision: null }),
    ).toMatchObject({ stars: 4, body: "" });
    expect(
      layerItemReviewInput.parse({
        stars: null,
        body: "  Nice  ",
        expectedRevision: 2,
      }),
    ).toMatchObject({ stars: null, body: "Nice", expectedRevision: 2 });
  });
  it("rejects empty, out-of-range, oversized and unknown input", () => {
    for (const bad of [
      { stars: null, body: "   ", expectedRevision: null },
      { stars: 0, expectedRevision: null },
      { stars: 6, expectedRevision: null },
      { stars: 3, body: "x".repeat(2001), expectedRevision: null },
      { stars: 3, expectedRevision: 0 },
      { stars: 3, expectedRevision: null, scope: "layer:x" },
      { stars: 3, body: "a\u0000b", expectedRevision: null },
    ])
      expect(layerItemReviewInput.safeParse(bad).success).toBe(false);
  });
  it("requires a revision to delete", () => {
    expect(layerItemReviewDeleteInput.safeParse({}).success).toBe(false);
    expect(
      layerItemReviewDeleteInput.safeParse({ expectedRevision: 1 }).success,
    ).toBe(true);
  });
});

describe("review cursor", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("round-trips microsecond timestamps and rejects malformed cursors", () => {
    const at = "2026-10-01 12:00:00.123457+00";
    expect(decodeReviewCursor(encodeReviewCursor(at, id))).toEqual({
      createdAt: at,
      id,
    });
    expect(decodeReviewCursor(undefined)).toBeNull();
    expect(decodeReviewCursor("not-a-cursor")).toBeNull();
    expect(
      decodeReviewCursor(Buffer.from("nope|" + id).toString("base64url")),
    ).toBeNull();
    expect(decodeReviewCursor(encodeReviewCursor(at, "1; DROP"))).toBeNull();
  });
});
