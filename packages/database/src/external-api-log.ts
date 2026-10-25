import { pool } from "./index";
/*
 * Append-only record of requests sent to third-party APIs (Google Places,
 * Census geocoder, Anthropic, source feeds, S3 storage, mail). Only metadata
 * is stored: provider, operation, method, host, path without its query string,
 * status, duration and a short error. Never request/response bodies, headers,
 * API keys or query strings, which can carry keys or user addresses. Logging
 * is best-effort: a failed insert is swallowed and never changes the outcome
 * of the API call it describes.
 */
export type ExternalApiCall = {
  provider: string;
  operation: string;
  method: string;
  host: string;
  path: string;
  status: number | null;
  ok: boolean;
  durationMs: number;
  error?: string | null;
  metadata?: Record<string, string | number | boolean>;
};
const maxErrorLength = 300;
/** Drops anything after "?" or "#" and keeps only host and path. */
export function describeUrl(input: string | URL | Request) {
  try {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );
    return { host: url.host, path: url.pathname };
  } catch {
    return { host: "invalid", path: "" };
  }
}
/** Short, key-free failure text; URLs and long values are cut. */
export function describeError(error: unknown) {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .replace(/(key|token|secret)=\S+/gi, "$1=[redacted]")
    .slice(0, maxErrorLength);
}
/** One dev-server-style line, e.g. ` POST places.googleapis.com/v1/places:searchText 200 in 312ms (google-places: text-search)`. */
export function formatExternalApiCall(call: ExternalApiCall) {
  const result = call.status ?? (call.ok ? "ok" : "failed");
  const detail = call.error ? ` - ${call.error}` : "";
  return ` ${call.method.toUpperCase()} ${call.host}${call.path} ${result} in ${Math.round(call.durationMs)}ms (${call.provider}: ${call.operation})${detail}`;
}
const consoleEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  process.env.EXTERNAL_API_LOG_CONSOLE === "true";
const colorEnabled = () =>
  !process.env.NO_COLOR &&
  (!!process.env.FORCE_COLOR || !!process.stdout?.isTTY);
// ANSI foreground colors; red is reserved for failures.
const providerColors = [36, 35, 33, 32, 34, 96, 95, 93];
const paint = (code: number, text: string) => `\u001b[${code}m${text}\u001b[0m`;
/** Same provider always gets the same color; failed calls are red. */
export function colorizeExternalApiCall(call: ExternalApiCall, line: string) {
  if (!call.ok) return paint(31, line);
  let hash = 0;
  for (const char of call.provider)
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return paint(providerColors[hash % providerColors.length], line);
}
export async function recordExternalApiCall(call: ExternalApiCall) {
  if (consoleEnabled()) {
    const line = "[external-api]" + formatExternalApiCall(call);
    console.info(colorEnabled() ? colorizeExternalApiCall(call, line) : line);
  }
  try {
    await pool.query(
      `INSERT INTO external_api_call
         (provider, operation, method, host, path, status, ok, duration_ms, error, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        call.provider,
        call.operation,
        call.method.toUpperCase(),
        call.host,
        call.path.slice(0, 300),
        call.status,
        call.ok,
        Math.max(0, Math.round(call.durationMs)),
        call.error ? call.error.slice(0, maxErrorLength) : null,
        JSON.stringify(call.metadata ?? {}),
      ],
    );
  } catch {
    // Best-effort; the API call's own result is what callers act on.
  }
}
/** Wraps a fetch so every request through it is recorded; the response is returned untouched. */
export function loggedFetch(
  provider: string,
  operation: string,
  base: typeof fetch = fetch,
  record: (call: ExternalApiCall) => Promise<void> = recordExternalApiCall,
): typeof fetch {
  return async (input, init) => {
    const started = Date.now();
    const { host, path } = describeUrl(input as string | URL | Request);
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    try {
      const response = await base(input, init);
      void record({
        provider,
        operation,
        method,
        host,
        path,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - started,
      });
      return response;
    } catch (error) {
      void record({
        provider,
        operation,
        method,
        host,
        path,
        status: null,
        ok: false,
        durationMs: Date.now() - started,
        error: describeError(error),
      });
      throw error;
    }
  };
}
/** Records a non-fetch call (SDK client, mailer, S3); `run` decides status and metadata from its result. */
export async function withExternalApiLog<T>(
  target: {
    provider: string;
    operation: string;
    method?: string;
    host: string;
    path?: string;
  },
  run: () => Promise<T>,
  summarize?: (result: T) => {
    status?: number;
    metadata?: ExternalApiCall["metadata"];
  },
  record: (call: ExternalApiCall) => Promise<void> = recordExternalApiCall,
): Promise<T> {
  const started = Date.now();
  const base = {
    provider: target.provider,
    operation: target.operation,
    method: target.method ?? "POST",
    host: target.host,
    path: target.path ?? "",
  };
  try {
    const result = await run();
    const summary = summarize?.(result);
    void record({
      ...base,
      status: summary?.status ?? null,
      ok: true,
      durationMs: Date.now() - started,
      metadata: summary?.metadata,
    });
    return result;
  } catch (error) {
    void record({
      ...base,
      status:
        typeof (error as { status?: unknown })?.status === "number"
          ? (error as { status: number }).status
          : null,
      ok: false,
      durationMs: Date.now() - started,
      error: describeError(error),
    });
    throw error;
  }
}
