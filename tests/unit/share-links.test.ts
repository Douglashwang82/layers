import { describe, expect, it } from "vitest";
import {
  isShareTokenShape,
  shareLinkLive,
  shareUrl,
} from "../../apps/web/src/features/layers/share-links";
import {
  generateOpaqueToken,
  hashToken,
} from "../../apps/web/src/features/membership/crypto";

const live = {
  lifecycle: "active",
  reviewStatus: "unsubmitted" as const,
  ownerKind: "user",
  createdBy: "u1",
  creatorCanManage: true,
};
describe("view-only share link helpers", () => {
  it("accepts issued tokens and rejects malformed or oversized ones", () => {
    const token = generateOpaqueToken();
    expect(isShareTokenShape(token)).toBe(true);
    expect(isShareTokenShape("short")).toBe(false);
    expect(isShareTokenShape("a".repeat(65))).toBe(false);
    expect(isShareTokenShape(`${token}/../x`)).toBe(false);
    expect(isShareTokenShape(undefined)).toBe(false);
  });
  it("hashes tokens deterministically without storing the raw value", () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(shareUrl(token)).toMatch(/\/shared\/[A-Za-z0-9_-]+$/);
  });
  it("stays live only while the creator still manages an active layer", () => {
    expect(shareLinkLive(live)).toBe(true);
    expect(shareLinkLive({ ...live, lifecycle: "archived" })).toBe(false);
    expect(shareLinkLive({ ...live, reviewStatus: "hidden" })).toBe(false);
    expect(shareLinkLive({ ...live, reviewStatus: "rejected" })).toBe(false);
    expect(shareLinkLive({ ...live, createdBy: null })).toBe(false);
    expect(shareLinkLive({ ...live, creatorCanManage: false })).toBe(false);
    expect(shareLinkLive({ ...live, ownerKind: "system" })).toBe(false);
  });
});
