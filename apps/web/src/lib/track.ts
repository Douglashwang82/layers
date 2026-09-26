/** Client-side outcome events: coarse names and values only, never location or search text. */
export const clientEventNames = [
  "map_opened",
  "layer_previewed",
  "layer_applied",
  "layer_hidden",
  "map_item_selected",
  "map_area_searched",
  "map_fallback_used",
  "layer_share_link_copied",
  // Provider usage estimates (component type only; never queries, IDs or locations).
  "business_search_opened",
  "business_selected",
  "places_component_loaded",
  "places_component_failed",
  // Daily Pick outcomes (city slug only). Shown is context; actions measure usefulness.
  "daily_pick_shown",
  "daily_pick_place_opened",
  "daily_pick_saved",
  "daily_pick_directions",
  "daily_pick_show_on_map",
  "daily_pick_history_opened",
] as const;
export type ClientEventName = (typeof clientEventNames)[number];
export function track(
  name: ClientEventName,
  properties: Record<string, string | number | boolean> = {},
) {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ name, properties });
    if (navigator.sendBeacon)
      navigator.sendBeacon(
        "/api/v1/analytics",
        new Blob([body], { type: "application/json" }),
      );
    else
      fetch("/api/v1/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
  } catch {
    /* analytics must never break the experience */
  }
}
