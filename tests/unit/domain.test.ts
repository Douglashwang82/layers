import { describe, it, expect } from "vitest";
import {
  recommendationScore,
  placeRank,
  requireActor,
  requireModerator,
  sightingInput,
  eventInput,
} from "../../packages/shared/src";
describe("Taiwanese recommendations", () => {
  it("handles no votes and calculates percentages", () => {
    expect(recommendationScore(0, 0)).toBeNull();
    expect(recommendationScore(23, 25)).toBe(92);
    expect(recommendationScore(0, 1)).toBe(0);
  });
  it("ranking rewards evidence over a single positive vote", () => {
    expect(placeRank(92, 100)).toBeGreaterThan(placeRank(1, 1));
  });
});
describe("authorization", () => {
  it("rejects guests and ordinary users for moderation", () => {
    expect(() => requireActor(null)).toThrow("Sign in");
    expect(() => requireModerator({ id: "x", role: "USER" })).toThrow(
      "Moderator",
    );
    expect(requireModerator({ id: "x", role: "MODERATOR" }).id).toBe("x");
  });
});
describe("boundary validation", () => {
  it("rejects future sightings and negative prices", () => {
    expect(
      sightingInput.safeParse({
        productId: crypto.randomUUID(),
        placeId: crypto.randomUUID(),
        observedAt: new Date(Date.now() + 86400000).toISOString(),
      }).success,
    ).toBe(false);
    expect(
      sightingInput.safeParse({
        productId: crypto.randomUUID(),
        placeId: crypto.randomUUID(),
        observedAt: new Date().toISOString(),
        price: -1,
      }).success,
    ).toBe(false);
  });
  it("rejects invalid event windows and markup", () => {
    expect(
      eventInput.safeParse({ name: "<script>", description: "test" }).success,
    ).toBe(false);
  });
});
