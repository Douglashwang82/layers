import { z } from "zod";
import { plainText } from "./text";
/* ---------------------------------------------------------------------------
   Google Maps share links (docs/plans/layer-mvp-google-links-plan.md, M1).
   Only single-place links are supported. Parsing is pure and never fetches:
   the server expands short links itself under a host allowlist, then parses
   the expanded URL again with the same rules.
   --------------------------------------------------------------------------- */
export const maxGoogleLinks = 50;
/** Google place IDs: the same shape the Places UI Kit adapter accepts. */
export const providerPlaceIdPattern = /^[A-Za-z0-9_-]{1,512}$/;
const shortHosts = new Set(["maps.app.goo.gl"]);
/** google.com, google.com.tw, google.co.uk, google.de, with an optional www./maps. prefix. */
const mapsHost = /^(?:(?:www|maps)\.)?google\.(?:com|[a-z]{2}|com?\.[a-z]{2})$/;
export type GoogleMapsLink =
  | { kind: "short"; url: string }
  | { kind: "place_id"; placeId: string }
  | {
      kind: "search";
      name: string;
      location: { latitude: number; longitude: number } | null;
    }
  | { kind: "unsupported"; reason: GoogleLinkReason };
export const googleLinkReasons = [
  "invalid_url",
  "not_google_maps",
  "list",
  "no_place_name",
  "redirect_blocked",
  "expand_failed",
  "no_match",
  "provider_error",
] as const;
export type GoogleLinkReason = (typeof googleLinkReasons)[number];
/** A short link (`maps.app.goo.gl/…`, `goo.gl/maps/…`) that must be expanded server-side. */
export function isShortMapsUrl(url: URL) {
  return (
    url.protocol === "https:" &&
    (shortHosts.has(url.hostname) ||
      (url.hostname === "goo.gl" && url.pathname.startsWith("/maps")))
  );
}
/** A full Google Maps URL on an allowlisted Google host. */
export function isGoogleMapsUrl(url: URL) {
  if (url.protocol !== "https:" || !mapsHost.test(url.hostname)) return false;
  return url.hostname.startsWith("maps.") || url.pathname.startsWith("/maps");
}
function coordinate(lat: string, lng: string) {
  const latitude = Number(lat),
    longitude = Number(lng);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    (latitude === 0 && longitude === 0)
  )
    return null;
  return { latitude, longitude };
}
const coordinatePair =
  /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment.replace(/\+/g, " ")).trim();
  } catch {
    return "";
  }
}
/** The first http(s) URL in pasted text; phone share sheets add the place name before it. */
export function extractUrl(text: string) {
  return /https?:\/\/[^\s<>"']+/i.exec(text)?.[0] ?? null;
}
/**
 * Classify one pasted link. A full place URL yields a name (from
 * `/maps/place/<name>`, `/maps/search/<name>` or `q=`/`query=`) plus the pin
 * or viewport coordinate used only as a search bias, or a place ID when the
 * URL carries one. Lists and coordinate-only links are unsupported.
 */
export function parseGoogleMapsLink(text: string): GoogleMapsLink {
  const raw = extractUrl(text);
  if (!raw) return { kind: "unsupported", reason: "invalid_url" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "unsupported", reason: "invalid_url" };
  }
  // Shared links are HTTPS; an http:// copy of the same Google URL is upgraded, never fetched as-is.
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.username || url.password || url.port)
    return { kind: "unsupported", reason: "not_google_maps" };
  if (isShortMapsUrl(url)) return { kind: "short", url: url.toString() };
  if (!isGoogleMapsUrl(url))
    return { kind: "unsupported", reason: "not_google_maps" };
  const path = url.pathname;
  const data = path.match(/\/data=([^/?]*)/)?.[1] ?? "";
  if (
    path.includes("/placelists/") ||
    (/!11m\d/.test(data) && !path.includes("/place/"))
  )
    return { kind: "unsupported", reason: "list" };
  const params = url.searchParams;
  const directId =
    params.get("query_place_id") ??
    /^place_id:(.+)$/.exec(params.get("q") ?? "")?.[1] ??
    null;
  if (directId && providerPlaceIdPattern.test(directId))
    return { kind: "place_id", placeId: directId };
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(data);
  const viewport = /\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(path);
  const ll = coordinatePair.exec(params.get("ll") ?? "");
  let location =
    (pin && coordinate(pin[1], pin[2])) ??
    (viewport && coordinate(viewport[1], viewport[2])) ??
    (ll && coordinate(ll[1], ll[2])) ??
    null;
  const segment =
    path.match(/\/maps\/(?:place|search)\/([^/]+)/)?.[1] ?? undefined;
  const candidates = [
    segment ? decodeSegment(segment) : "",
    params.get("q")?.trim() ?? "",
    params.get("query")?.trim() ?? "",
  ];
  let name = "";
  for (const candidate of candidates) {
    if (!candidate) continue;
    const pair = coordinatePair.exec(candidate);
    if (pair) {
      location ??= coordinate(pair[1], pair[2]);
      continue;
    }
    name = candidate;
    break;
  }
  if (!name) return { kind: "unsupported", reason: "no_place_name" };
  return { kind: "search", name: name.slice(0, 200), location };
}
const linkText = z.string().trim().min(1).max(2048);
export const googleLinksResolveInput = z.object({
  links: z.array(linkText).min(1).max(maxGoogleLinks),
});
const providerPlaceIds = z
  .array(z.string().regex(providerPlaceIdPattern))
  .min(1)
  .max(maxGoogleLinks);
/** Same limit the link parser applies to a name. */
const linkName = plainText(200);
/**
 * Place names read from the pasted links, by place ID. Stored on the layer
 * item only, so they label the place in that layer and nowhere else.
 */
const linkNames = z
  .record(z.string().regex(providerPlaceIdPattern), linkName)
  .optional();
export const googlePlacesImportInput = z.object({
  providerPlaceIds,
  linkNames,
});
/** A new private or group layer filled from resolved Google places in one transaction. */
export const layerFromGoogleInput = z
  .object({
    title: plainText(80),
    titleChinese: z.string().trim().max(80).default(""),
    description: z.string().trim().max(500).default(""),
    city: z.string().regex(/^[a-z0-9-]+$/),
    audience: z.enum(["private", "group"]).default("private"),
    groupId: z.uuid().optional(),
    providerPlaceIds,
    linkNames,
  })
  .refine((v) => v.audience !== "group" || !!v.groupId, {
    message: "Choose a group.",
    path: ["groupId"],
  });
export type GoogleLinkResult = {
  input: string;
  status: "resolved" | "unsupported" | "not_found" | "failed";
  providerPlaceId?: string;
  /** The place name read from the link: shown in the preview, and kept on the layer item when added. */
  name?: string;
  reason?: GoogleLinkReason;
};
