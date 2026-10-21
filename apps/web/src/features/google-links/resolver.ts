import { z } from "zod";
import {
  isGoogleMapsUrl,
  isShortMapsUrl,
  parseGoogleMapsLink,
  providerPlaceIdPattern,
  type GoogleLinkReason,
  type GoogleLinkResult,
} from "@taiwanhub/shared";
/*
 * Resolves pasted Google Maps share links to Google place IDs
 * (docs/plans/layer-mvp-google-links-plan.md §2). Network access is limited
 * to two kinds of request: following a short link's redirects, hop by hop,
 * only while every hop stays on an allowlisted HTTPS Google Maps host (the
 * body is never read), and one IDs-only Places Text Search per link. No model
 * is involved, coordinates read from a URL are only a search bias, and
 * nothing here is stored. Separately, `fetchPlaceLocation` looks up a place's
 * coordinates for the 30-day pin cache (./locations.ts).
 */
export type ResolverDeps = {
  fetch: typeof fetch;
  apiKey: string;
  timeoutMs?: number;
  maxHops?: number;
};
class LinkFailure extends Error {
  constructor(
    readonly status: Exclude<GoogleLinkResult["status"], "resolved">,
    readonly reason: GoogleLinkReason,
  ) {
    super(reason);
  }
}
/** Follows a short link to the full Google Maps URL it points at. */
export async function expandShortLink(url: string, deps: ResolverDeps) {
  let current = new URL(url);
  for (let hop = 0; hop < (deps.maxHops ?? 5); hop++) {
    let response: Response;
    try {
      response = await deps.fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
      });
    } catch {
      throw new LinkFailure("failed", "expand_failed");
    }
    // Only the Location header matters; never download the page.
    await response.body?.cancel().catch(() => {});
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location)
      throw new LinkFailure("failed", "expand_failed");
    let next: URL;
    try {
      next = new URL(location, current);
      // A consent interstitial carries the real destination; read it, never fetch the interstitial.
      if (
        next.protocol === "https:" &&
        next.hostname === "consent.google.com" &&
        next.searchParams.get("continue")
      )
        next = new URL(next.searchParams.get("continue")!);
    } catch {
      throw new LinkFailure("failed", "expand_failed");
    }
    if (isShortMapsUrl(next)) {
      current = next;
      continue;
    }
    if (isGoogleMapsUrl(next)) return next.toString();
    throw new LinkFailure("unsupported", "redirect_blocked");
  }
  throw new LinkFailure("failed", "expand_failed");
}
const searchResponse = z.object({
  places: z
    .array(z.object({ id: z.string().regex(providerPlaceIdPattern) }))
    .optional(),
});
/**
 * One Places API (New) Text Search with the `places.id` field mask only (the
 * IDs-only SKU), biased to the link's coordinate when it has one.
 */
export async function findPlaceId(
  name: string,
  location: { latitude: number; longitude: number } | null,
  deps: ResolverDeps,
) {
  let response: Response;
  try {
    response = await deps.fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": deps.apiKey,
          "X-Goog-FieldMask": "places.id",
        },
        body: JSON.stringify({
          textQuery: name,
          pageSize: 1,
          ...(location
            ? { locationBias: { circle: { center: location, radius: 500 } } }
            : {}),
        }),
      },
    );
  } catch {
    throw new LinkFailure("failed", "provider_error");
  }
  if (!response.ok) throw new LinkFailure("failed", "provider_error");
  const parsed = searchResponse.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) throw new LinkFailure("failed", "provider_error");
  return parsed.data.places?.[0]?.id ?? null;
}
export async function resolveLink(
  input: string,
  deps: ResolverDeps,
): Promise<GoogleLinkResult> {
  try {
    let link = parseGoogleMapsLink(input);
    if (link.kind === "short") {
      link = parseGoogleMapsLink(await expandShortLink(link.url, deps));
      if (link.kind === "short")
        throw new LinkFailure("failed", "expand_failed");
    }
    if (link.kind === "unsupported")
      return { input, status: "unsupported", reason: link.reason };
    if (link.kind === "place_id")
      return { input, status: "resolved", providerPlaceId: link.placeId };
    const id = await findPlaceId(link.name, link.location, deps);
    return id
      ? { input, status: "resolved", providerPlaceId: id, name: link.name }
      : { input, status: "not_found", reason: "no_match", name: link.name };
  } catch (error) {
    if (error instanceof LinkFailure)
      return { input, status: error.status, reason: error.reason };
    return { input, status: "failed", reason: "provider_error" };
  }
}
const detailsResponse = z.object({
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
});
/**
 * One Places API (New) Place Details request with the `location` field mask
 * only. Null when Google has no such place or answers without a location;
 * throws on network or provider errors so callers can retry later.
 */
export async function fetchPlaceLocation(placeId: string, deps: ResolverDeps) {
  if (!providerPlaceIdPattern.test(placeId)) return null;
  const response = await deps.fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
      headers: {
        "X-Goog-Api-Key": deps.apiKey,
        "X-Goog-FieldMask": "location",
      },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("provider_error");
  const parsed = detailsResponse.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) return null;
  const { latitude: lat, longitude: lng } = parsed.data.location;
  // A literal (0,0) is a provider failure, never a real business.
  return lat === 0 && lng === 0 ? null : { lat, lng };
}
/** Resolves a batch with bounded concurrency; one bad link never fails the rest. */
export async function resolveLinks(
  inputs: string[],
  deps: ResolverDeps,
  concurrency = 4,
) {
  const results: GoogleLinkResult[] = new Array(inputs.length);
  let next = 0;
  const worker = async () => {
    while (next < inputs.length) {
      const index = next++;
      results[index] = await resolveLink(inputs[index], deps);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, worker),
  );
  return results;
}
function hash(text: string) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
/**
 * Test double for the network (key "fake", non-production only): short links
 * cannot be expanded, and Text Search answers a deterministic `fake-link-`
 * place ID that the fake Places UI Kit provider renders and locates near
 * downtown Houston. Place Details answers the same location the fake UI Kit
 * provider gives that ID (lib/places/provider.ts). Never real business data.
 */
export const fakeResolverFetch: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const details =
    /^https:\/\/places\.googleapis\.com\/v1\/places\/(fake-link-[a-z0-9]+)$/.exec(
      url,
    );
  if (details) {
    const h = hash(details[1]);
    return Response.json({
      location: {
        latitude: 29.7604 + ((h % 200) - 100) / 4000,
        longitude: -95.3698 + (((h >> 8) % 200) - 100) / 4000,
      },
    });
  }
  if (url !== "https://places.googleapis.com/v1/places:searchText")
    return new Response(null, { status: 404 });
  const body = JSON.parse(String(init?.body ?? "{}")) as { textQuery?: string };
  const query = body.textQuery ?? "";
  // A query naming "nowhere" finds nothing, for tests of the not-found path.
  if (/nowhere/i.test(query)) return Response.json({});
  return Response.json({
    places: [{ id: `fake-link-${hash(query.toLowerCase()).toString(36)}` }],
  });
};
