import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  safeReturnTo,
  canTransitionNomination,
  batchHasCapacity,
  batchSeatsUsed,
  nominationEmailInput,
  nominationDecisionInput,
} from "../../packages/shared/src";
describe("normalizeEmail", () => {
  it("trims and lowercases without touching dots or +tags", () => {
    expect(normalizeEmail("  Foo.Bar+tag@Example.COM  ")).toBe(
      "foo.bar+tag@example.com",
    );
  });
});
describe("safeReturnTo", () => {
  it("accepts a same-origin relative path", () => {
    expect(safeReturnTo("/layers/houston")).toBe("/layers/houston");
  });
  it("rejects protocol-relative, backslash, and absolute URLs", () => {
    expect(safeReturnTo("//evil.example")).toBeUndefined();
    expect(safeReturnTo("/\\evil.example")).toBeUndefined();
    expect(safeReturnTo("https://evil.example")).toBeUndefined();
    expect(safeReturnTo("javascript:alert(1)")).toBeUndefined();
    expect(safeReturnTo(undefined)).toBeUndefined();
  });
});
describe("nomination state machine", () => {
  it("allows a reviewer to ask for more info or approve, not skip to joined", () => {
    expect(canTransitionNomination("pending_review", "needs_info")).toBe(
      true,
    );
    expect(canTransitionNomination("pending_review", "approved")).toBe(true);
    expect(canTransitionNomination("pending_review", "joined")).toBe(false);
    expect(canTransitionNomination("joined", "pending_review")).toBe(false);
  });
});
describe("batch seat accounting", () => {
  it("counts redeemed plus still-active issued invitations against capacity", () => {
    expect(batchSeatsUsed(18, 2)).toBe(20);
    expect(batchHasCapacity(20, 18, 2)).toBe(false);
    expect(batchHasCapacity(20, 18, 1)).toBe(true);
  });
});
describe("membership input schemas", () => {
  it("requires a reason for needs_info and reject but not approve", () => {
    expect(
      nominationDecisionInput.safeParse({ decision: "approve", revision: 1 })
        .success,
    ).toBe(true);
    expect(
      nominationDecisionInput.safeParse({ decision: "reject", revision: 1 })
        .success,
    ).toBe(false);
    expect(
      nominationDecisionInput.safeParse({
        decision: "reject",
        revision: 1,
        reason: "Not a fit yet.",
      }).success,
    ).toBe(true);
  });
  it("keeps the nomination note optional and bounded", () => {
    expect(
      nominationEmailInput.safeParse({ email: "friend@example.com" }).success,
    ).toBe(true);
    expect(
      nominationEmailInput.safeParse({
        email: "friend@example.com",
        note: "x".repeat(301),
      }).success,
    ).toBe(false);
  });
});
