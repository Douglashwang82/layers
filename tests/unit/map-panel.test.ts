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
    expect(initialPanelOpen({ hasItem: false, fallback: false })).toBe(false);
  });

  it("opens for shared items and a missing map", () => {
    expect(initialPanelOpen({ hasItem: true, fallback: false })).toBe(true);
    expect(initialPanelOpen({ hasItem: false, fallback: true })).toBe(true);
  });

  it("honors only an explicit legacy preference", () => {
    expect(storedPanelOpen(null)).toBeNull();
    expect(storedPanelOpen("")).toBeNull();
    expect(storedPanelOpen("true")).toBe(false);
    expect(storedPanelOpen("false")).toBe(true);
  });

  it("never hides the panel when the map is unavailable", () => {
    expect(panelVisible({ open: false, fallback: false })).toBe(false);
    expect(panelVisible({ open: false, fallback: true })).toBe(true);
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

  it("clears the open account sidebar on the right with a gap", () => {
    expect(mapPadding({ ...base, rightPanelInset: 372 }).right).toBe(384);
    expect(mapPadding({ ...base, rightPanelInset: 0 }).right).toBe(80);
  });

  it("ignores the account sidebar on mobile, where it covers the map", () => {
    expect(
      mapPadding({ ...base, mobile: true, rightPanelInset: 372 }).right,
    ).toBe(0);
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
  };

  it("is the Layers list unless another screen is open", () => {
    expect(resolvePanelView(onMap)).toBe("layers");
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

  it("puts a trip screen over everything else, keeping the rest for its exit", () => {
    const all = {
      ...onMap,
      tripScreen: true,
      layerScreen: true,
      routeOpen: true,
      detailOpen: true,
      listView: true,
    };
    expect(resolvePanelView(all)).toBe("trip-screen");
    expect(resolvePanelView({ ...all, tripScreen: false })).toBe(
      "layer-screen",
    );
    // Closing the trip returns to what was open under it.
    expect(
      resolvePanelView({ ...all, tripScreen: false, layerScreen: false }),
    ).toBe("route");
  });

  it("shows details over Layers", () => {
    expect(resolvePanelView({ ...onMap, detailOpen: true })).toBe("detail");
  });
});
