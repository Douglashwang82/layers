/**
 * Trip panel state lives in the map URL, like the layer panel:
 * `?tripPanel=list` the member's trips, `?tripPanel=new&tripLayer=<id>` (or
 * `tripFolder=<id>`) the new-trip flow, `?trip=<id>` one trip, and
 * `tripDay=<dayId>` the focused day (absent = all days).
 */
export const tripPanelKeys = [
  "tripPanel",
  "trip",
  "tripLayer",
  "tripFolder",
  "tripDay",
] as const;

export type TripPanelState =
  | { panel: "list" }
  | { panel: "new"; layer?: string; folder?: string }
  | { panel: "detail"; id: string; day: string };

/** What the URL asks for; null when it asks for no trip screen. */
export function readTripPanel(params: URLSearchParams): TripPanelState | null {
  const id = params.get("trip");
  if (id) return { panel: "detail", id, day: params.get("tripDay") || "all" };
  const panel = params.get("tripPanel");
  if (panel === "list") return { panel: "list" };
  if (panel === "new")
    return {
      panel: "new",
      layer: params.get("tripLayer") || undefined,
      folder: params.get("tripFolder") || undefined,
    };
  return null;
}

function cleared(current: string) {
  const params = new URLSearchParams(current.replace(/^\?/, ""));
  for (const key of tripPanelKeys) params.delete(key);
  return params;
}

function href(params: URLSearchParams) {
  return "/" + (params.size ? "?" + params.toString() : "");
}

/** Leaves the trip screens and keeps the map state. */
export function withoutTripPanel(current: string) {
  return href(cleared(current));
}

/**
 * Opens a trip screen over the map state. `current` must already be free of
 * layer panel keys (use `withoutLayerPanel`) so the URL names one screen.
 */
export function tripPanelHref(
  current: string,
  target:
    | { panel: "list" }
    | { panel: "new"; layer?: string; folder?: string }
    | { panel: "detail"; id: string; day?: string },
) {
  const params = cleared(current);
  if (target.panel === "detail") {
    params.set("trip", target.id);
    if (target.day && target.day !== "all") params.set("tripDay", target.day);
  } else {
    params.set("tripPanel", target.panel);
    if (target.panel === "new") {
      if (target.layer) params.set("tripLayer", target.layer);
      else if (target.folder) params.set("tripFolder", target.folder);
    }
  }
  return href(params);
}

/** The same URL with a different focused day, for `replaceState`. */
export function withTripDay(current: string, day: string) {
  const params = new URLSearchParams(current.replace(/^\?/, ""));
  if (day === "all") params.delete("tripDay");
  else params.set("tripDay", day);
  return href(params);
}

/** The sign-in URL that returns to this exact map state. */
export function signInHref(current: string) {
  const params = new URLSearchParams(current.replace(/^\?/, ""));
  return `/sign-in?next=${encodeURIComponent(href(params))}`;
}
