/** Legacy key from the fixed sidebar; "true" meant collapsed. Reused for the floating list. */
export const panelStorageKey = "taiwanhub.map.sidebar-collapsed";

/**
 * Server-safe starting state. Shared item links and a missing map must show
 * the panel immediately; a fresh map session starts quiet.
 */
export function initialPanelOpen(input: {
  hasItem: boolean;
  fallback: boolean;
}) {
  return input.hasItem || input.fallback;
}

/** The remembered desktop preference, or null when there is none to honor. */
export function storedPanelOpen(value: string | null): boolean | null {
  if (value === "true") return false;
  if (value === "false") return true;
  return null;
}

/** Whether the floating panel is on screen; with no map it cannot be hidden. */
export function panelVisible(input: { open: boolean; fallback: boolean }) {
  return input.open || input.fallback;
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
  visible: boolean;
  /** Distance from the left edge to the panel's right edge, when shown. */
  panelRight: number;
  /** Distance from the right edge to the account sidebar's left edge, when shown (desktop). */
  rightPanelInset?: number;
  panelHeight: number;
  /** Bottom of the top search cluster. */
  topInset: number;
  /** Space reserved for the bottom entry and navigation. */
  bottomInset: number;
  viewportHeight: number;
}): MapPadding {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  const top = Math.min(
    Math.max(0, Math.round(input.topInset + 12)),
    Math.max(0, input.viewportHeight - 96),
  );
  if (!input.mobile)
    return {
      ...none,
      top,
      bottom: Math.min(80, Math.max(0, input.viewportHeight - top - 64)),
      right: input.rightPanelInset
        ? Math.max(80, Math.round(input.rightPanelInset + 12))
        : 80,
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
  "trip-screen" | "layer-screen" | "route" | "detail" | "layers";

/**
 * Which screen the panel shows, highest priority first. Trip and layer
 * screens are URL state and win (a trip over a layer screen if both are named);
 * the route planner opens over an open place and returns to it. Otherwise the
 * panel is the Layers list.
 */
export function resolvePanelView(input: {
  /** A trip screen (list, new trip or one trip) is asked for and trips are enabled. */
  tripScreen?: boolean;
  layerScreen: boolean;
  routeOpen: boolean;
  detailOpen: boolean;
}): PanelView {
  if (input.tripScreen) return "trip-screen";
  if (input.layerScreen) return "layer-screen";
  if (input.routeOpen) return "route";
  if (input.detailOpen) return "detail";
  return "layers";
}
