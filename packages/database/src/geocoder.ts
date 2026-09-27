import { z } from "zod";
/**
 * US Census one-line address geocoder: free, keyless, public domain, US
 * addresses, and no restriction on storing what it returns. Mapbox needs the
 * permanent-geocoding endpoint and the matching plan before results may be
 * kept, so stored coordinates come from here (or from a member's own pin).
 *
 * Returns null when the address has no match. Throws GeocoderError when the
 * service is unreachable, slow, oversized or answers something unexpected;
 * callers decide whether that is fatal. The response is untrusted input.
 */
export class GeocoderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocoderError";
  }
}
export type GeocodeResult = {
  latitude: number;
  longitude: number;
  matchedAddress: string;
};
export const maxGeocodeAddressLength = 300;
const maxResponseBytes = 1_000_000;
const censusResponse = z.object({
  result: z.object({
    addressMatches: z
      .array(
        z.object({
          matchedAddress: z.string().max(500).optional(),
          coordinates: z.object({
            x: z.number().finite().min(-180).max(180),
            y: z.number().finite().min(-90).max(90),
          }),
        }),
      )
      .max(50),
  }),
});
export async function geocodeAddress(
  address: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<GeocodeResult | null> {
  const query = address.trim().replace(/\s+/g, " ");
  if (!query) return null;
  if (query.length > maxGeocodeAddressLength)
    throw new GeocoderError("Address is too long to geocode.");
  const { fetchImpl = fetch, timeoutMs = 8000 } = options;
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(query)}` +
    "&benchmark=Public_AR_Current&format=json";
  let text: string;
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
      headers: { accept: "application/json" },
    });
    if (!response.ok)
      throw new GeocoderError(`Geocoder returned HTTP ${response.status}.`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > maxResponseBytes)
      throw new GeocoderError("Geocoder response is too large.");
    text = await response.text();
  } catch (error) {
    if (error instanceof GeocoderError) throw error;
    throw new GeocoderError(
      `Geocoder is unavailable (${(error as Error).name}).`,
    );
  }
  if (text.length > maxResponseBytes)
    throw new GeocoderError("Geocoder response is too large.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GeocoderError("Geocoder returned malformed JSON.");
  }
  const parsed = censusResponse.safeParse(json);
  if (!parsed.success)
    throw new GeocoderError("Geocoder returned an unexpected response.");
  const match = parsed.data.result.addressMatches[0];
  if (!match) return null;
  return {
    latitude: match.coordinates.y,
    longitude: match.coordinates.x,
    matchedAddress: match.matchedAddress ?? "",
  };
}
/** Great-circle distance in kilometres, for keeping matches near the intended city. */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
