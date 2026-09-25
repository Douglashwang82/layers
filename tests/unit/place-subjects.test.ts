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
