import { describe, expect, it } from "vitest";
import {
  initialPanelOpen,
  mapPadding,
  panelVisible,
  resolvePanelView,
  storedPanelOpen,
} from "@/lib/map-panel";

describe("floating map panel state", () => {
  it("starts collapsed on a fresh map session", () => {
    expect(
      initialPanelOpen({ hasItem: false, listView: false, fallback: false }),
    ).toBe(false);
  });

  it("opens for shared items, list view and a missing map", () => {
    for (const patch of [
      { hasItem: true },
      { listView: true },
      { fallback: true },
    ])
      expect(
        initialPanelOpen({
          hasItem: false,
          listView: false,
          fallback: false,
          ...patch,
        }),
      ).toBe(true);
  });

  it("honors only an explicit legacy preference", () => {
    expect(storedPanelOpen(null)).toBeNull();
    expect(storedPanelOpen("")).toBeNull();
    expect(storedPanelOpen("true")).toBe(false);
    expect(storedPanelOpen("false")).toBe(true);
  });

  it("never hides the panel in list view or when the map is unavailable", () => {
    expect(
      panelVisible({ open: false, listView: false, fallback: false }),
    ).toBe(false);
    expect(panelVisible({ open: false, listView: true, fallback: false })).toBe(
      true,
    );
    expect(panelVisible({ open: false, listView: false, fallback: true })).toBe(
      true,
    );
  });
});

describe("map padding for floating chrome", () => {
  const base = {
    mobile: false,
    listView: false,
    visible: true,
    panelRight: 384,
    panelHeight: 320,
    topInset: 120,
    bottomInset: 80,
    viewportHeight: 844,
  };

  it("clears floating controls when the desktop panel is collapsed", () => {
    expect(mapPadding({ ...base, visible: false })).toEqual({
      top: 132,
      right: 80,
      bottom: 80,
      left: 0,
    });
  });

  it("clears the open desktop panel with a gap", () => {
    expect(mapPadding(base).left).toBe(396);
  });

  it("uses no padding in list view", () => {
    expect(mapPadding({ ...base, listView: true })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it("reserves the entry and navigation when the mobile sheet is closed", () => {
    expect(mapPadding({ ...base, mobile: true, visible: false })).toMatchObject(
      { top: 132, bottom: 80, left: 0 },
    );
  });

  it("clears the sheet while retaining a small usable map strip", () => {
    expect(mapPadding({ ...base, mobile: true }).bottom).toBe(400);
    const tall = mapPadding({ ...base, mobile: true, panelHeight: 900 });
    expect(tall.bottom).toBe(648);
    expect(844 - tall.top - tall.bottom).toBeGreaterThanOrEqual(64);
  });
});

describe("panel view", () => {
  const onMap = {
    layerScreen: false,
    routeOpen: false,
    detailOpen: false,
    listView: false,
    fallback: false,
    unlocatedPlaces: 0,
    layersRequested: false,
  };

  it("is the Layers list while the map shows the places", () => {
    expect(resolvePanelView(onMap)).toBe("layers");
  });

  it("lists results with no map to show them, or a place with no pin", () => {
    for (const patch of [
      { listView: true },
      { fallback: true },
      { unlocatedPlaces: 1 },
    ])
      expect(resolvePanelView({ ...onMap, ...patch })).toBe("results");
  });

  it("goes back to Layers over the list on request", () => {
    expect(
      resolvePanelView({ ...onMap, listView: true, layersRequested: true }),
    ).toBe("layers");
  });

  it("orders layer screens over the planner, the planner over details", () => {
    const all = {
      ...onMap,
      layerScreen: true,
      routeOpen: true,
      detailOpen: true,
    };
    expect(resolvePanelView(all)).toBe("layer-screen");
    expect(resolvePanelView({ ...all, layerScreen: false })).toBe("route");
    expect(
      resolvePanelView({ ...all, layerScreen: false, routeOpen: false }),
    ).toBe("detail");
  });

  it("shows details over the list and over Layers", () => {
    expect(
      resolvePanelView({ ...onMap, detailOpen: true, listView: true }),
    ).toBe("detail");
    expect(
      resolvePanelView({ ...onMap, detailOpen: true, layersRequested: true }),
    ).toBe("detail");
  });
});
