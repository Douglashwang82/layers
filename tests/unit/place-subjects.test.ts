import { describe, it, expect } from "vitest";
import {
  canonicalSubjectKey,
  parseItemKey,
  parseSubjectKey,
  placeSubjectLookupInput,
  placeSubjectResolveInput,
  placeSubjectSaveInput,
  providerPlaceId,
  subjectHref,
  subjectKey,
  ownerWriteStatus,
  placeReviewInput,
  reviewScope,
  summarizeRatings,
} from "../../packages/shared/src";
import {
  selectionGrantTtlMs,
  signSelectionGrant,
  verifySelectionGrant,
} from "../../apps/web/src/features/place-subjects/grant";
const uuid = "00000000-0000-4000-8000-000000005000";
describe("place subject resolve contract", () => {
  it("accepts exactly a catalog place or a provider reference", () => {
    expect(placeSubjectResolveInput.parse({ catalogPlaceId: uuid })).toEqual({
      catalogPlaceId: uuid,
    });
    expect(
      placeSubjectResolveInput.parse({
        provider: "google",
        providerPlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
      }),
    ).toEqual({
      provider: "google",
      providerPlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    });
  });
  it("rejects both identities, extra fields, and unknown providers", () => {
    for (const body of [
      {
        catalogPlaceId: uuid,
        provider: "google",
        providerPlaceId: "ChIJabc",
      },
      { catalogPlaceId: uuid, cityId: uuid },
      { provider: "google", providerPlaceId: "ChIJabc", name: "Injected" },
      { provider: "yelp", providerPlaceId: "abc" },
      { catalogPlaceId: "not-a-uuid" },
      {},
    ])
      expect(placeSubjectResolveInput.safeParse(body).success).toBe(false);
  });
  it("bounds and restricts provider place IDs", () => {
    expect(providerPlaceId.safeParse("a".repeat(512)).success).toBe(true);
    for (const bad of [
      "",
      "a".repeat(513),
      "places/ChIJabc",
      "ChIJ abc",
      "ChIJ'; DROP TABLE place;--",
      "<script>",
    ])
      expect(providerPlaceId.safeParse(bad).success).toBe(false);
  });
  it("validates lookup queries and save bodies strictly", () => {
    expect(
      placeSubjectLookupInput.safeParse({ provider: "google" }).success,
    ).toBe(false);
    expect(placeSubjectSaveInput.safeParse({}).success).toBe(true);
    expect(
      placeSubjectSaveInput.safeParse({ selectionGrant: "x".repeat(1025) })
        .success,
    ).toBe(false);
    expect(placeSubjectSaveInput.safeParse({ userId: uuid }).success).toBe(
      false,
    );
  });
});
describe("subject reference keys", () => {
  it("keeps subject keys separate from visible item types", () => {
    expect(subjectKey(uuid)).toBe(`subject:${uuid}`);
    expect(parseSubjectKey(`subject:${uuid}`)).toEqual({
      kind: "subject",
      id: uuid,
    });
    expect(parseSubjectKey(`place:${uuid}`)).toBeNull();
    // Existing layer item routes do not accept subject keys until P4 wires them.
    expect(parseItemKey(`subject:${uuid}`)).toBeNull();
  });
  it("uses the existing place identity for catalog-linked subjects", () => {
    expect(canonicalSubjectKey({ id: uuid, catalogPlaceId: null })).toBe(
      `subject:${uuid}`,
    );
    const catalog = "00000000-0000-4000-8000-000000005001";
    expect(canonicalSubjectKey({ id: uuid, catalogPlaceId: catalog })).toBe(
      `place:${catalog}`,
    );
    expect(subjectHref(uuid)).toBe(`/place-subjects/${uuid}`);
  });
});
describe("selection grants", () => {
  const secret = "unit-test-secret-000000000000000000000";
  const claims = { actorId: uuid, subjectId: crypto.randomUUID() };
  const now = Date.UTC(2026, 8, 25);
  it("verifies only for the same actor, subject, and secret before expiry", () => {
    const token = signSelectionGrant(claims, secret, now);
    expect(verifySelectionGrant(token, claims, secret, now + 1000)).toBe(true);
    expect(
      verifySelectionGrant(
        token,
        { ...claims, actorId: crypto.randomUUID() },
        secret,
        now,
      ),
    ).toBe(false);
    expect(
      verifySelectionGrant(
        token,
        { ...claims, subjectId: crypto.randomUUID() },
        secret,
        now,
      ),
    ).toBe(false);
    expect(verifySelectionGrant(token, claims, secret + "-other", now)).toBe(
      false,
    );
  });
  it("expires after ten minutes", () => {
    const token = signSelectionGrant(claims, secret, now);
    expect(selectionGrantTtlMs).toBe(10 * 60 * 1000);
    expect(
      verifySelectionGrant(
        token,
        claims,
        secret,
        now + selectionGrantTtlMs - 1,
      ),
    ).toBe(true);
    expect(
      verifySelectionGrant(token, claims, secret, now + selectionGrantTtlMs),
    ).toBe(false);
  });
  it("rejects tampered, malformed, and forged tokens", () => {
    const token = signSelectionGrant(claims, secret, now);
    const [, sig] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        p: "taiwanhub:place-subject-selection-grant:v1",
        a: claims.actorId,
        s: claims.subjectId,
        e: now + 10 ** 12,
      }),
    ).toString("base64url");
    for (const bad of [
      `${forgedPayload}.${sig}`,
      "",
      "no-dot",
      `${token}.extra`,
      `${token.split(".")[0]}.`,
    ])
      expect(verifySelectionGrant(bad, claims, secret, now)).toBe(false);
  });
});
describe("scoped review rules", () => {
  const scope = `group:${uuid}`;
  it("parses layer and group scopes only", () => {
    expect(reviewScope.parse(`layer:${uuid}`)).toEqual({
      kind: "layer",
      id: uuid,
    });
    expect(reviewScope.parse(scope)).toEqual({ kind: "group", id: uuid });
    for (const bad of [`public:${uuid}`, `group:${uuid}x`, "", `place:${uuid}`])
      expect(reviewScope.safeParse(bad).success).toBe(false);
  });
  it("accepts stars, a comment, or both, but never neither", () => {
    const ok = (v: object) =>
      placeReviewInput.safeParse({ scope, expectedRevision: null, ...v })
        .success;
    expect(ok({ stars: 5, body: "" })).toBe(true);
    expect(ok({ stars: null, body: "Nice" })).toBe(true);
    expect(ok({ stars: 3, body: "Nice" })).toBe(true);
    expect(ok({ stars: null, body: "   " })).toBe(false);
    for (const stars of [0, 6, 2.5])
      expect(ok({ stars, body: "x" })).toBe(false);
    expect(ok({ stars: 5, body: "x".repeat(2001) })).toBe(false);
    expect(ok({ stars: 5, body: "bad" })).toBe(false);
    expect(ok({ stars: 5, body: "", userId: uuid })).toBe(false);
  });
  it("derives the status after an owner write", () => {
    expect(ownerWriteStatus(null, false)).toBe("approved");
    expect(ownerWriteStatus(null, true)).toBe("pending");
    expect(
      ownerWriteStatus({ status: "approved", deletionSource: null }, true),
    ).toBe("pending");
    expect(
      ownerWriteStatus({ status: "rejected", deletionSource: null }, false),
    ).toBe("pending");
    expect(
      ownerWriteStatus({ status: "hidden", deletionSource: null }, false),
    ).toBe("hidden");
    expect(
      ownerWriteStatus({ status: "deleted", deletionSource: "author" }, false),
    ).toBe("approved");
    expect(
      ownerWriteStatus(
        { status: "deleted", deletionSource: "moderator" },
        false,
      ),
    ).toBeNull();
  });
  it("summarizes ratings without inventing a zero", () => {
    expect(summarizeRatings([])).toEqual({
      totalReviews: 0,
      ratedCount: 0,
      averageStars: null,
    });
    expect(summarizeRatings([null, null])).toEqual({
      totalReviews: 2,
      ratedCount: 0,
      averageStars: null,
    });
    expect(summarizeRatings([5, 4, null, 4])).toEqual({
      totalReviews: 4,
      ratedCount: 3,
      averageStars: 4.3,
    });
  });
});
