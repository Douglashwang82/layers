import { describe, expect, it, vi } from "vitest";
import {
  distanceKm,
  geocodeAddress,
  GeocoderError,
} from "../../packages/database/src/geocoder";
/* Deterministic fixtures only: every call goes through a mocked fetch. */
function respond(body: unknown, init: ResponseInit = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return vi.fn<typeof fetch>(
    async () => new Response(text, { status: 200, ...init }),
  );
}
const houstonMatch = {
  result: {
    addressMatches: [
      {
        matchedAddress: "9600 BELLAIRE BLVD, HOUSTON, TX, 77036",
        coordinates: { x: -95.55, y: 29.705 },
      },
    ],
  },
};
describe("geocodeAddress", () => {
  it("returns the first match's coordinates", async () => {
    const fetchImpl = respond(houstonMatch);
    await expect(
      geocodeAddress("9600 Bellaire Blvd, Houston TX", { fetchImpl }),
    ).resolves.toEqual({
      latitude: 29.705,
      longitude: -95.55,
      matchedAddress: "9600 BELLAIRE BLVD, HOUSTON, TX, 77036",
    });
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toMatch(
      /^https:\/\/geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress\?/,
    );
    expect(url).toContain("address=9600%20Bellaire%20Blvd%2C%20Houston%20TX");
  });
  it("returns null for no match and skips blank input without a request", async () => {
    await expect(
      geocodeAddress("nowhere", {
        fetchImpl: respond({ result: { addressMatches: [] } }),
      }),
    ).resolves.toBeNull();
    const fetchImpl = respond(houstonMatch);
    await expect(geocodeAddress("   ", { fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects overlong input before any request", async () => {
    const fetchImpl = respond(houstonMatch);
    await expect(
      geocodeAddress("x".repeat(301), { fetchImpl }),
    ).rejects.toBeInstanceOf(GeocoderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("treats HTTP errors, timeouts and network failures as unavailable", async () => {
    await expect(
      geocodeAddress("a", { fetchImpl: respond("busy", { status: 503 }) }),
    ).rejects.toBeInstanceOf(GeocoderError);
    const timeout = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(
      geocodeAddress("a", { fetchImpl: timeout }),
    ).rejects.toBeInstanceOf(GeocoderError);
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      geocodeAddress("a", { fetchImpl: offline }),
    ).rejects.toBeInstanceOf(GeocoderError);
  });
  it("rejects malformed, unexpected and oversized responses", async () => {
    for (const body of [
      "<html>not json</html>",
      { result: { addressMatches: [{ coordinates: { x: "-95", y: "29" } }] } },
      { result: { addressMatches: [{ coordinates: { x: -95, y: 120 } }] } },
      { unexpected: true },
    ])
      await expect(
        geocodeAddress("a", { fetchImpl: respond(body) }),
      ).rejects.toBeInstanceOf(GeocoderError);
    await expect(
      geocodeAddress("a", {
        fetchImpl: respond(houstonMatch, {
          headers: { "content-length": "5000000" },
        }),
      }),
    ).rejects.toBeInstanceOf(GeocoderError);
  });
});
describe("distanceKm", () => {
  it("measures great-circle distance", () => {
    const houston = { latitude: 29.7604, longitude: -95.3698 };
    expect(distanceKm(houston, houston)).toBe(0);
    const dallas = { latitude: 32.7767, longitude: -96.797 };
    expect(distanceKm(houston, dallas)).toBeGreaterThan(350);
    expect(distanceKm(houston, dallas)).toBeLessThan(380);
  });
});
