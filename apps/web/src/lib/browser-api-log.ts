/*
 * Reports requests the visitor's browser makes to billed provider APIs
 * (Google Maps JS / Places, Mapbox) so they land in the same external API log
 * as server-side calls. Only host, a shortened path and timing are sent; the
 * query string is dropped here because it carries the API key, and the path
 * is cut to its first segments because geocoding paths embed search text.
 */
const endpoint = "/api/v1/client-api-calls";
const flushDelayMs = 2000;
const maxBatch = 50;
export type BrowserCall = {
  host: string;
  path: string;
  resourceType: string;
  status: number | null;
  durationMs: number;
};
/** Hosts whose browser requests are billed to this project's keys. */
export const isBilledHost = (host: string) =>
  host === "maps.googleapis.com" ||
  host === "places.googleapis.com" ||
  host.endsWith(".mapbox.com");
const queue: BrowserCall[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
export function shortenPath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return "/" + parts.slice(0, 3).join("/") + (parts.length > 3 ? "/…" : "");
}
function flush() {
  timer = undefined;
  const batch = queue.splice(0, maxBatch);
  if (!batch.length) return;
  try {
    const body = JSON.stringify({ calls: batch });
    if (
      !navigator.sendBeacon?.(
        endpoint,
        new Blob([body], { type: "application/json" }),
      )
    )
      void fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
  } catch {
    /* logging must never break the experience */
  }
  if (queue.length) timer = setTimeout(flush, flushDelayMs);
}
export function reportBrowserCall(
  url: string,
  resourceType: string,
  extra?: Partial<BrowserCall>,
) {
  try {
    const parsed = new URL(url, location.href);
    if (!isBilledHost(parsed.hostname)) return;
    queue.push({
      host: parsed.hostname,
      path: shortenPath(parsed.pathname),
      resourceType,
      status: null,
      durationMs: 0,
      ...extra,
    });
    timer ??= setTimeout(flush, flushDelayMs);
  } catch {
    /* ignore malformed URLs */
  }
}
/** Mapbox GL option: sees every request including those made by its workers. Never alters the request. */
export const mapboxTransformRequest = (url: string, resourceType?: string) => {
  reportBrowserCall(url, resourceType ?? "unknown");
  return { url };
};
let started = false;
/** Google's loader and widgets run on the main thread, so resource timing sees them. Mapbox goes through transformRequest instead. */
export function startBrowserApiObserver() {
  if (started || typeof PerformanceObserver === "undefined") return;
  started = true;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        if (entry.name.includes(endpoint)) continue;
        let host: string;
        try {
          host = new URL(entry.name).hostname;
        } catch {
          continue;
        }
        if (host.endsWith(".mapbox.com")) continue;
        reportBrowserCall(entry.name, entry.initiatorType || "resource", {
          status: entry.responseStatus || null,
          durationMs: Math.round(entry.duration),
        });
      }
    });
    observer.observe({ type: "resource", buffered: true });
    addEventListener("pagehide", flush);
  } catch {
    /* unsupported browser */
  }
}
