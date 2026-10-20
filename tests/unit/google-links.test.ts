import { describe, expect, it, vi } from "vitest";
import {
  layerEventInput,
  layerFromGoogleInput,
  localDateTimeOf,
  parseGoogleMapsLink,
  zonedDateTime,
} from "@taiwanhub/shared";
import {
  expandShortLink,
  fakeResolverFetch,
  findPlaceId,
  resolveLink,
  resolveLinks,
  type ResolverDeps,
} from "@/features/google-links/resolver";
/* Google Maps share links (docs/plans/layer-mvp-google-links-plan.md §2). */
const placeUrl =
  "https://www.google.com/maps/place/Tiger+Den/@29.7052,-95.5523,17z/data=!3m1!4b1!4m6!3m5!1s0x8640c3:0x1a2b!8m2!3d29.70521!4d-95.55012!16s%2Fg%2F11";
describe("parseGoogleMapsLink", () => {
  it("reads the name and the pin coordinate from a place URL", () => {
    expect(parseGoogleMapsLink(placeUrl)).toEqual({
      kind: "search",
      name: "Tiger Den",
      location: { latitude: 29.70521, longitude: -95.55012 },
    });
  });
  it("falls back to the viewport coordinate and decodes the name", () => {
    expect(
      parseGoogleMapsLink(
        "https://www.google.com/maps/place/%E9%BC%8E%E6%B3%B0%E8%B1%90/@29.7,-95.5,15z",
      ),
    ).toEqual({
      kind: "search",
      name: "鼎泰豐",
      location: { latitude: 29.7, longitude: -95.5 },
    });
  });
  it("accepts q= and query= links, regional hosts and an http copy", () => {
    expect(
      parseGoogleMapsLink("http://maps.google.com/?q=Kim+Son+Restaurant"),
    ).toMatchObject({ kind: "search", name: "Kim Son Restaurant" });
    expect(
      parseGoogleMapsLink(
        "https://www.google.com.tw/maps/search/?api=1&query=Boba+Cafe",
      ),
    ).toMatchObject({ kind: "search", name: "Boba Cafe", location: null });
  });
  it("uses a place ID carried by the URL directly", () => {
    expect(
      parseGoogleMapsLink(
        "https://www.google.com/maps/search/?api=1&query=Cafe&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4",
      ),
    ).toEqual({ kind: "place_id", placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" });
    expect(
      parseGoogleMapsLink(
        "https://maps.google.com/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4",
      ),
    ).toEqual({ kind: "place_id", placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" });
  });
  it("recognises short links, also inside phone share text", () => {
    expect(
      parseGoogleMapsLink(
        "Tiger Den\nhttps://maps.app.goo.gl/AbC123xyz?g_st=ic",
      ),
    ).toEqual({
      kind: "short",
      url: "https://maps.app.goo.gl/AbC123xyz?g_st=ic",
    });
    expect(parseGoogleMapsLink("https://goo.gl/maps/xyz")).toMatchObject({
      kind: "short",
    });
  });
  it("rejects lists, coordinates-only links and anything not Google Maps", () => {
    const reason = (text: string) =>
      (parseGoogleMapsLink(text) as { reason?: string }).reason;
    expect(reason("https://www.google.com/maps/placelists/list/abc")).toBe(
      "list",
    );
    expect(
      reason(
        "https://www.google.com/maps/@29.7,-95.5,14z/data=!4m3!11m2!2sAbC!3e3",
      ),
    ).toBe("list");
    expect(reason("https://www.google.com/maps/@29.7,-95.5,14z")).toBe(
      "no_place_name",
    );
    expect(reason("https://maps.google.com/?q=29.7,-95.5")).toBe(
      "no_place_name",
    );
    expect(reason("https://www.google.com/search?q=tiger+den")).toBe(
      "not_google_maps",
    );
    expect(reason("https://google.com.evil.example/maps/place/X")).toBe(
      "not_google_maps",
    );
    expect(reason("https://user:pw@www.google.com/maps/place/X")).toBe(
      "not_google_maps",
    );
    expect(reason("https://goo.gl/abc")).toBe("not_google_maps");
    expect(reason("just some words")).toBe("invalid_url");
  });
});
function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}
function deps(fetch: ResolverDeps["fetch"]): ResolverDeps {
  return { fetch, apiKey: "test-key", timeoutMs: 1000 };
}
describe("expandShortLink", () => {
  it("follows short-link hops to the Google Maps URL", async () => {
    const fetch = vi
      .fn<ResolverDeps["fetch"]>()
      .mockResolvedValueOnce(redirect("https://maps.app.goo.gl/next"))
      .mockResolvedValueOnce(redirect(placeUrl, 301));
    await expect(
      expandShortLink("https://maps.app.goo.gl/AbC", deps(fetch)),
    ).resolves.toBe(placeUrl);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
  it("reads a consent interstitial's destination without fetching it", async () => {
    const fetch = vi
      .fn<ResolverDeps["fetch"]>()
      .mockResolvedValueOnce(
        redirect(
          `https://consent.google.com/m?continue=${encodeURIComponent(placeUrl)}`,
        ),
      );
    await expect(
      expandShortLink("https://maps.app.goo.gl/AbC", deps(fetch)),
    ).resolves.toBe(placeUrl);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("never follows a redirect off the Google Maps allowlist", async () => {
    for (const target of [
      "https://evil.example/maps/place/X",
      "http://www.google.com/maps/place/X",
      "https://127.0.0.1/maps",
      "https://consent.google.com/m?continue=https://evil.example/",
    ]) {
      const fetch = vi
        .fn<ResolverDeps["fetch"]>()
        .mockResolvedValueOnce(redirect(target));
      await expect(
        resolveLink("https://maps.app.goo.gl/AbC", deps(fetch)),
      ).resolves.toMatchObject({
        status: "unsupported",
        reason: "redirect_blocked",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("gives up on loops, non-redirects and network errors", async () => {
    const loop = vi
      .fn<ResolverDeps["fetch"]>()
      .mockImplementation(async () =>
        redirect("https://maps.app.goo.gl/again"),
      );
    await expect(
      resolveLink("https://maps.app.goo.gl/AbC", deps(loop)),
    ).resolves.toMatchObject({ status: "failed", reason: "expand_failed" });
    expect(loop).toHaveBeenCalledTimes(5);
    const ok = vi
      .fn<ResolverDeps["fetch"]>()
      .mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(
      resolveLink("https://maps.app.goo.gl/AbC", deps(ok)),
    ).resolves.toMatchObject({ status: "failed", reason: "expand_failed" });
    const down = vi
      .fn<ResolverDeps["fetch"]>()
      .mockRejectedValue(new TypeError("network"));
    await expect(
      resolveLink("https://maps.app.goo.gl/AbC", deps(down)),
    ).resolves.toMatchObject({ status: "failed", reason: "expand_failed" });
  });
});
describe("findPlaceId", () => {
  it("asks Places Text Search for IDs only, biased to the link's pin", async () => {
    const fetch = vi
      .fn<ResolverDeps["fetch"]>()
      .mockResolvedValue(Response.json({ places: [{ id: "ChIJabc_123" }] }));
    await expect(
      findPlaceId(
        "Tiger Den",
        { latitude: 29.7, longitude: -95.5 },
        deps(fetch),
      ),
    ).resolves.toBe("ChIJabc_123");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(init?.headers).toMatchObject({
      "X-Goog-Api-Key": "test-key",
      "X-Goog-FieldMask": "places.id",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      textQuery: "Tiger Den",
      pageSize: 1,
      locationBias: {
        circle: { center: { latitude: 29.7, longitude: -95.5 }, radius: 500 },
      },
    });
  });
  it("reports no match, provider errors and malformed answers", async () => {
    const answer = (response: Response) =>
      resolveLink(placeUrl, deps(vi.fn().mockResolvedValue(response)));
    await expect(answer(Response.json({}))).resolves.toMatchObject({
      status: "not_found",
      reason: "no_match",
      name: "Tiger Den",
    });
    await expect(
      answer(new Response("quota", { status: 429 })),
    ).resolves.toMatchObject({ status: "failed", reason: "provider_error" });
    await expect(
      answer(Response.json({ places: [{ id: "<script>" }] })),
    ).resolves.toMatchObject({ status: "failed", reason: "provider_error" });
  });
});
describe("resolveLinks", () => {
  it("keeps input order and isolates failures", async () => {
    const fetch = vi.fn<ResolverDeps["fetch"]>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://maps.app.goo.gl/")) return redirect(placeUrl);
      const query = JSON.parse(String(init?.body)).textQuery as string;
      return Response.json({ places: [{ id: `id-${query.length}` }] });
    });
    const results = await resolveLinks(
      [
        "https://maps.app.goo.gl/AbC",
        "https://www.google.com/maps/placelists/list/x",
        "https://maps.google.com/?q=Kim+Son",
        "not a link",
      ],
      deps(fetch),
    );
    expect(results.map((r) => r.status)).toEqual([
      "resolved",
      "unsupported",
      "resolved",
      "unsupported",
    ]);
    expect(results[0]).toMatchObject({
      providerPlaceId: "id-9",
      name: "Tiger Den",
    });
    expect(results[2].input).toBe("https://maps.google.com/?q=Kim+Son");
  });
  it("the test double is deterministic and never expands short links", async () => {
    const fake: ResolverDeps = { fetch: fakeResolverFetch, apiKey: "fake" };
    const a = await resolveLink(placeUrl, fake);
    const b = await resolveLink(placeUrl, fake);
    expect(a.providerPlaceId).toMatch(/^fake-link-/);
    expect(b.providerPlaceId).toBe(a.providerPlaceId);
    await expect(
      resolveLink("https://maps.google.com/?q=Nowhere+Diner", fake),
    ).resolves.toMatchObject({ status: "not_found" });
    await expect(
      resolveLink("https://maps.app.goo.gl/AbC", fake),
    ).resolves.toMatchObject({ status: "failed" });
  });
});
describe("layer inputs", () => {
  it("requires a group for a group layer and bounds the place list", () => {
    const base = {
      title: "Weekend list",
      city: "houston",
      providerPlaceIds: ["ChIJ1"],
    };
    expect(layerFromGoogleInput.safeParse(base).success).toBe(true);
    expect(
      layerFromGoogleInput.safeParse({ ...base, audience: "group" }).success,
    ).toBe(false);
    expect(
      layerFromGoogleInput.safeParse({
        ...base,
        providerPlaceIds: Array.from({ length: 51 }, (_, i) => `id${i}`),
      }).success,
    ).toBe(false);
    expect(
      layerFromGoogleInput.safeParse({ ...base, providerPlaceIds: ["a b"] })
        .success,
    ).toBe(false);
  });
  it("accepts wall-clock event times in order on a place key only", () => {
    const event = {
      key: "subject:00000000-0000-4000-8000-000000000001",
      title: "Night market",
      startsAt: "2026-11-07T18:00",
      endsAt: "2026-11-07T22:00",
    };
    expect(layerEventInput.safeParse(event).success).toBe(true);
    expect(
      layerEventInput.safeParse({ ...event, endsAt: "2026-11-07T17:00" })
        .success,
    ).toBe(false);
    expect(
      layerEventInput.safeParse({
        ...event,
        key: "event:00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });
});
describe("zonedDateTime", () => {
  it("converts wall-clock time in the city's zone across DST", () => {
    // Houston: CDT (UTC-5) before Nov 1 2026, CST (UTC-6) after.
    expect(
      zonedDateTime("2026-10-31T18:00", "America/Chicago").toISOString(),
    ).toBe("2026-10-31T23:00:00.000Z");
    expect(
      zonedDateTime("2026-11-07T18:00", "America/Chicago").toISOString(),
    ).toBe("2026-11-08T00:00:00.000Z");
    expect(
      localDateTimeOf(new Date("2026-11-08T00:00:00Z"), "America/Chicago"),
    ).toBe("2026-11-07T18:00");
  });
});
