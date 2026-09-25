"use client";
/**
 * Google Places UI Kit adapter. It only loads the supported UI Kit web
 * components and relays their documented events (`gmp-select`, `gmp-load`).
 * It never calls Place.fetchFields, Places REST, or ordinary autocomplete, so
 * the provider's own attributed components stay visible on our Mapbox map.
 * Provider payloads stay in memory; nothing here persists or logs them.
 *
 * A deterministic fake provider (key "fake", non-production builds only)
 * backs browser tests and local work without a live key or paid requests.
 */
export type LatLng = { lat: number; lng: number };
export type ProviderPlace = { id: string; location: LatLng | null };
export type Cleanup = () => void;
export type PlacesProvider = {
  kind: "google" | "fake";
  mountAutocomplete(
    container: HTMLElement,
    options: { bias: LatLng; label: string },
    onSelect: (place: ProviderPlace) => void,
  ): Promise<Cleanup>;
  mountSearch(
    container: HTMLElement,
    options: { query: string; bias: LatLng; maxResults: number },
    handlers: {
      onResults: (places: ProviderPlace[]) => void;
      onSelect: (place: ProviderPlace) => void;
      onError: () => void;
    },
  ): Promise<Cleanup>;
  mountDetails(
    container: HTMLElement,
    options: { placeId: string; compact: boolean },
    handlers: {
      onLoad: (place: ProviderPlace) => void;
      onError: () => void;
    },
  ): Promise<Cleanup>;
};
/** Validate a provider location before it can ever become a pin: finite and in range. */
export function validLocation(value: unknown): LatLng | null {
  if (!value || typeof value !== "object") return null;
  const v = value as {
    lat?: number | (() => number);
    lng?: number | (() => number);
  };
  const lat = typeof v.lat === "function" ? v.lat() : v.lat;
  const lng = typeof v.lng === "function" ? v.lng() : v.lng;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  )
    return null;
  // A literal (0,0) is a provider failure, never a real business on this map.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}
const placeIdPattern = /^[A-Za-z0-9_-]{1,512}$/;
function toPlace(raw: unknown): ProviderPlace | null {
  const place = raw as { id?: unknown; location?: unknown } | null;
  if (!place || typeof place.id !== "string" || !placeIdPattern.test(place.id))
    return null;
  return { id: place.id, location: validLocation(place.location) };
}
/* ------------------------------ Google --------------------------------- */
type GoogleNamespace = {
  maps: { importLibrary(name: string): Promise<Record<string, unknown>> };
};
let loading: Promise<void> | null = null;
function loadGoogle(key: string, language: string) {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    if ((w.google as GoogleNamespace | undefined)?.maps?.importLibrary)
      return resolve();
    const callback = "__taiwanhubPlacesReady";
    w[callback] = () => resolve();
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key,
      v: "weekly",
      loading: "async",
      language,
      callback,
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("provider-unavailable"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
function googleProvider(key: string, language: string): PlacesProvider {
  const ready = async () => {
    await loadGoogle(key, language);
    const g = (window as unknown as { google: GoogleNamespace }).google;
    return g.maps.importLibrary("places");
  };
  const listen = (el: Element, name: string, fn: (e: Event) => void) => {
    el.addEventListener(name, fn);
    return () => el.removeEventListener(name, fn);
  };
  return {
    kind: "google",
    async mountAutocomplete(container, { bias, label }, onSelect) {
      await ready();
      const el = document.createElement("gmp-basic-place-autocomplete");
      Object.assign(el, {
        locationBias: { center: bias, radius: 30000 },
        includedRegionCodes: ["us"],
      });
      el.setAttribute("aria-label", label);
      container.appendChild(el);
      const off = listen(el, "gmp-select", (e) => {
        const place = toPlace((e as Event & { place?: unknown }).place);
        if (place) onSelect(place);
      });
      return () => {
        off();
        el.remove();
      };
    },
    async mountSearch(container, { query, bias, maxResults }, handlers) {
      await ready();
      const search = document.createElement("gmp-place-search");
      search.setAttribute("selectable", "");
      const request = document.createElement("gmp-place-text-search-request");
      Object.assign(request, {
        textQuery: query,
        locationBias: bias,
        maxResultCount: maxResults,
      });
      search.appendChild(request);
      search.appendChild(document.createElement("gmp-place-standard-content"));
      container.appendChild(search);
      const offs = [
        listen(search, "gmp-load", () => {
          const places = (
            ((search as unknown as { places?: unknown[] }).places ??
              []) as unknown[]
          )
            .map(toPlace)
            .filter((p): p is ProviderPlace => !!p);
          handlers.onResults(places);
        }),
        listen(search, "gmp-select", (e) => {
          const place = toPlace((e as Event & { place?: unknown }).place);
          if (place) handlers.onSelect(place);
        }),
        listen(search, "gmp-error", () => handlers.onError()),
      ];
      return () => {
        offs.forEach((off) => off());
        search.remove();
      };
    },
    async mountDetails(container, { placeId, compact }, handlers) {
      await ready();
      const details = document.createElement(
        compact ? "gmp-place-details-compact" : "gmp-place-details",
      );
      const request = document.createElement("gmp-place-details-place-request");
      request.setAttribute("place", placeId);
      details.appendChild(request);
      details.appendChild(
        document.createElement(
          compact ? "gmp-place-standard-content" : "gmp-place-all-content",
        ),
      );
      container.appendChild(details);
      const offs = [
        listen(details, "gmp-load", () => {
          const place = toPlace(
            (details as unknown as { place?: unknown }).place,
          );
          if (place) handlers.onLoad(place);
          else handlers.onError();
        }),
        listen(details, "gmp-error", () => handlers.onError()),
      ];
      return () => {
        offs.forEach((off) => off());
        details.remove();
      };
    },
  };
}
/* ------------------------------- Fake ---------------------------------- */
function hash(text: string) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
/** Synthetic places near the bias point. Clearly labeled; never real business data. */
function fakePlace(seed: string, bias: LatLng): ProviderPlace {
  const h = hash(seed);
  return {
    id: `fake-${h.toString(36)}`,
    location: {
      lat: bias.lat + ((h % 200) - 100) / 4000,
      lng: bias.lng + (((h >> 8) % 200) - 100) / 4000,
    },
  };
}
const fakeLocations = new Map<string, LatLng>();
function fakeProvider(): PlacesProvider {
  const remember = (p: ProviderPlace) => {
    if (p.location) fakeLocations.set(p.id, p.location);
    return p;
  };
  return {
    kind: "fake",
    async mountAutocomplete(container, { bias, label }, onSelect) {
      const form = document.createElement("form");
      form.className = "fake-provider";
      const input = document.createElement("input");
      input.setAttribute("aria-label", label);
      input.dataset.testid = "fake-autocomplete";
      const button = document.createElement("button");
      button.type = "submit";
      button.textContent = "Select (test provider)";
      form.append(input, button);
      const submit = (e: Event) => {
        e.preventDefault();
        const text = input.value.trim();
        if (text) onSelect(remember(fakePlace(text, bias)));
      };
      form.addEventListener("submit", submit);
      container.appendChild(form);
      return () => {
        form.removeEventListener("submit", submit);
        form.remove();
      };
    },
    async mountSearch(container, { query, bias, maxResults }, handlers) {
      const list = document.createElement("ul");
      list.className = "fake-provider";
      const places = Array.from({ length: Math.min(3, maxResults) }, (_, i) =>
        remember(fakePlace(`${query}#${i}`, bias)),
      );
      for (const place of places) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `Test business ${place.id}`;
        button.addEventListener("click", () => handlers.onSelect(place));
        item.appendChild(button);
        list.appendChild(item);
      }
      container.appendChild(list);
      queueMicrotask(() => handlers.onResults(places));
      return () => list.remove();
    },
    async mountDetails(container, { placeId }, handlers) {
      const box = document.createElement("div");
      box.className = "fake-provider";
      box.textContent = `Test business ${placeId} · test provider data`;
      container.appendChild(box);
      const location = fakeLocations.get(placeId) ?? null;
      queueMicrotask(() =>
        placeId.startsWith("fake-")
          ? handlers.onLoad({ id: placeId, location })
          : handlers.onError(),
      );
      return () => box.remove();
    },
  };
}
let cached: { key: string; language: string; provider: PlacesProvider } | null =
  null;
/** The configured provider, or null when discovery has no usable key. */
export function getPlacesProvider(
  key: string | undefined,
  language: string,
): PlacesProvider | null {
  if (!key) return null;
  if (cached && cached.key === key && cached.language === language)
    return cached.provider;
  const provider =
    key === "fake"
      ? process.env.NODE_ENV === "production"
        ? null
        : fakeProvider()
      : googleProvider(key, language);
  if (!provider) return null;
  cached = { key, language, provider };
  return provider;
}
