import {
  AppError,
  extractUrl,
  instagramPostUrl,
  instagramExtractionSchema,
  type InstagramExtraction,
  type GoogleLinkResult,
} from "@taiwanhub/shared";
import { findPlaceId, type ResolverDeps } from "./resolver";

export function workerConfig() {
  const raw = process.env.INSTAGRAM_WORKER_URL;
  const token = process.env.INSTAGRAM_WORKER_TOKEN;
  if (!raw || !token || token.length < 32) return null;
  try {
    const url = new URL(raw);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && url.hostname === "127.0.0.1"))
    )
      return null;
    return { url: new URL("/extract", url), token };
  } catch {
    return null;
  }
}
export async function requestInstagramExtraction(
  url: string,
): Promise<InstagramExtraction> {
  const config = workerConfig();
  if (!config)
    throw new AppError(
      503,
      "INSTAGRAM_UNAVAILABLE",
      "Instagram import is not configured.",
    );
  const response = await fetch(config.url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(190000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({ url }),
  });
  if (response.status === 429)
    throw new AppError(
      429,
      "INSTAGRAM_BUSY",
      "Instagram import is busy. Try again shortly.",
    );
  if (!response.ok) throw new Error("Instagram extraction failed");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty worker response");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 65536) throw new Error("Worker response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const result = instagramExtractionSchema.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  if (result.sourceUrl !== url) throw new Error("Worker source mismatch");
  return result;
}
export async function resolveInstagramLink(
  input: string,
  deps: ResolverDeps,
  extract = requestInstagramExtraction,
): Promise<GoogleLinkResult[]> {
  const sourceUrl = instagramPostUrl(extractUrl(input) ?? input);
  const base = { input, sourceUrl, source: "instagram" as const };
  let extracted: InstagramExtraction;
  try {
    extracted = await extract(sourceUrl);
  } catch (error) {
    const reason =
      error instanceof AppError && error.code === "INSTAGRAM_BUSY"
        ? "instagram_busy"
        : error instanceof AppError && error.code === "INSTAGRAM_UNAVAILABLE"
          ? "instagram_unavailable"
          : "instagram_failed";
    return [{ ...base, status: "failed", reason }];
  }
  if (!extracted.restaurants.length)
    return [{ ...base, status: "not_found", reason: "instagram_no_places" }];
  // At most five paid searches. Larger list posts require manual Maps links.
  if (extracted.restaurants.length > 5)
    return [
      { ...base, status: "unsupported", reason: "instagram_too_many_places" },
    ];
  const results: GoogleLinkResult[] = [];
  for (const candidate of extracted.restaurants) {
    const item = {
      ...base,
      name: candidate.name ?? undefined,
      address: candidate.address ?? undefined,
      potentiallyTruncated: extracted.potentiallyTruncated,
    };
    if (!candidate.name || !candidate.address) {
      results.push({
        ...item,
        status: "not_found",
        reason: "instagram_missing_fields",
      });
      continue;
    }
    try {
      const id = await findPlaceId(
        `${candidate.name} ${candidate.address}`,
        null,
        deps,
      );
      results.push(
        id
          ? { ...item, status: "resolved", providerPlaceId: id }
          : { ...item, status: "not_found", reason: "no_match" },
      );
    } catch {
      results.push({ ...item, status: "failed", reason: "provider_error" });
    }
  }
  return results;
}
