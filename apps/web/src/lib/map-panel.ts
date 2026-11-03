/** Legacy key from the fixed sidebar; "true" meant collapsed. Reused for the floating list. */
export const panelStorageKey = "taiwanhub.map.sidebar-collapsed";

/**
 * Server-safe starting state. Shared item links, the pure list view and a
 * missing map must show content immediately; a fresh map session starts quiet.
 */
export function initialPanelOpen(input: {
  hasItem: boolean;
  listView: boolean;
  fallback: boolean;
}) {
  return input.hasItem || input.listView || input.fallback;
}

/** The remembered desktop preference, or null when there is none to honor. */
export function storedPanelOpen(value: string | null): boolean | null {
  if (value === "true") return false;
  if (value === "false") return true;
  return null;
}

/** Whether the floating panel is on screen; list view and fallback cannot be hidden. */
export function panelVisible(input: {
  open: boolean;
  listView: boolean;
  fallback: boolean;
}) {
  return input.open || input.listView || input.fallback;
}

export type MapPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * The part of the canvas that stays visible around floating chrome. Every
 * camera move (selection, fit, search results, geolocation) uses this one rule.
 */
export function mapPadding(input: {
  mobile: boolean;
  listView: boolean;
  visible: boolean;
  /** Distance from the left edge to the panel's right edge, when shown. */
  panelRight: number;
  panelHeight: number;
  /** Bottom of the top search cluster. */
  topInset: number;
  /** Space reserved for the bottom entry and navigation. */
  bottomInset: number;
  viewportHeight: number;
}): MapPadding {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (input.listView) return none;
  const top = Math.min(
    Math.max(0, Math.round(input.topInset + 12)),
    Math.max(0, input.viewportHeight - 96),
  );
  if (!input.mobile)
    return {
      ...none,
      top,
      bottom: Math.min(80, Math.max(0, input.viewportHeight - top - 64)),
      right: 80,
      left: input.visible ? Math.max(0, Math.round(input.panelRight + 12)) : 0,
    };
  const wanted =
    input.bottomInset + (input.visible ? Math.max(0, input.panelHeight) : 0);
  // Clear the actual sheet instead of centering a selected point behind it.
  const room = Math.max(0, input.viewportHeight - top - 64);
  return { ...none, top, bottom: Math.round(Math.min(wanted, room)) };
}

/** The one screen the panel shows at a time. */
export type PanelView =
  "layer-screen" | "route" | "detail" | "layers" | "results";

/** Whether the results list exists: no map to show it, or places without pins. */
export function listAvailable(input: {
  listView: boolean;
  fallback: boolean;
  unlocatedPlaces: number;
}) {
  return input.listView || input.fallback || input.unlocatedPlaces > 0;
}

/**
 * Which screen the panel shows, highest priority first. Layer screens are URL
 * state and win; the route planner opens over an open place and returns to it.
 * Otherwise the panel is the Layers list unless there is a results list to show.
 */
export function resolvePanelView(input: {
  layerScreen: boolean;
  routeOpen: boolean;
  detailOpen: boolean;
  listView: boolean;
  fallback: boolean;
  unlocatedPlaces: number;
  /** The Layers screen was asked for over the list. */
  layersRequested: boolean;
}): PanelView {
  if (input.layerScreen) return "layer-screen";
  if (input.routeOpen) return "route";
  if (input.detailOpen) return "detail";
  return listAvailable(input) && !input.layersRequested ? "results" : "layers";
}
