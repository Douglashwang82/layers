/**
 * Custom pin images (layer editors' sticker markers) on the Mapbox canvas.
 * A feature only carries `pin` once its image is registered on the map, so a
 * slow or broken image keeps the ordinary category dot instead of a gap.
 */
export type PinStatus = "loading" | "ready" | "failed";

/** Stable Mapbox image id for a marker URL (FNV-1a; ids only need to be unique per map). */
export function customPinId(url: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `pin-${(h >>> 0).toString(36)}-${url.length.toString(36)}`;
}

/** The `pin` feature property for a marker URL, only when its image is ready. */
export function pinProperty(
  url: string | null | undefined,
  status: ReadonlyMap<string, PinStatus>,
): { pin?: string } {
  return url && status.get(url) === "ready" ? { pin: customPinId(url) } : {};
}

/** Marker URLs not yet requested on this map. */
export function pendingPinUrls(
  urls: Iterable<string | null | undefined>,
  status: ReadonlyMap<string, PinStatus>,
) {
  const out = new Set<string>();
  for (const url of urls) if (url && !status.has(url)) out.add(url);
  return [...out];
}
