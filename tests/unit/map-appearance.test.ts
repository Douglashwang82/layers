import { describe, expect, it, vi } from "vitest";
import type { LayerSpecification, Map as MapboxMap } from "mapbox-gl";
import {
  applyJadeAtlas,
  flatMapOptions,
  jadePalette,
} from "@/lib/map-appearance";

function fixture(layers: LayerSpecification[]) {
  const map = {
    getStyle: () => ({ layers }),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    setLayerZoomRange: vi.fn(),
  };
  return {
    map,
    apply: (locale: "en" | "zh-TW") =>
      applyJadeAtlas(map as unknown as MapboxMap, locale),
  };
}

describe("Jade Atlas basemap", () => {
  it("enforces a flat projection even when gestures or the style request tilt", () => {
    expect(flatMapOptions).toMatchObject({
      projection: { name: "mercator" },
      pitch: 0,
      maxPitch: 0,
      bearing: 0,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
    });
  });

  it("keeps provider geography and road widths while suppressing extrusions and unrelated POIs", () => {
    const layers: LayerSpecification[] = [
      { id: "water", type: "fill", source: "base" },
      { id: "landuse", type: "fill", source: "base" },
      {
        id: "road-primary",
        type: "line",
        source: "base",
        paint: { "line-width": 4 },
      },
      { id: "road-rail", type: "line", source: "base" },
      { id: "buildings-3d", type: "fill-extrusion", source: "base" },
      { id: "poi-label", type: "symbol", source: "base" },
    ];
    const before = structuredClone(layers);
    const { map, apply } = fixture(layers);
    apply("en");
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      "water",
      "fill-color",
      jadePalette.water,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      "road-primary",
      "line-color",
      jadePalette.road,
    );
    expect(
      map.setPaintProperty.mock.calls.some(
        ([id, property]) => id === "road-rail" || property === "line-width",
      ),
    ).toBe(false);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "buildings-3d",
      "visibility",
      "none",
    );
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "poi-label",
      "visibility",
      "none",
    );
    expect(layers).toEqual(before);
  });

  it("uses the warm low-saturation palette", () => {
    expect(jadePalette).toMatchObject({
      land: "#f3f3f3",
      road: "#ffffff",
      roadEdge: "#d9d9d9",
      park: "#e6e6e6",
      water: "#d4d4d4",
      primary: "#111111",
    });
  });

  it("reduces detail when zoomed out without lowering a stricter provider minimum", () => {
    const { map, apply } = fixture([
      { id: "road-street", type: "line", source: "base", minzoom: 12 },
      { id: "road-service", type: "line", source: "base", minzoom: 16 },
      { id: "road-primary", type: "line", source: "base" },
      { id: "road-label", type: "symbol", source: "base" },
      { id: "admin-1-boundary", type: "line", source: "base" },
    ]);
    apply("en");
    expect(map.setLayerZoomRange).toHaveBeenCalledWith("road-street", 14, 24);
    expect(map.setLayerZoomRange).toHaveBeenCalledWith("road-service", 16, 24);
    expect(map.setLayerZoomRange).toHaveBeenCalledWith("road-label", 14, 24);
    expect(
      map.setLayerZoomRange.mock.calls.some(([id]) => id === "road-primary"),
    ).toBe(false);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      "admin-1-boundary",
      "line-color",
      jadePalette.boundary,
    );
  });

  it("localizes after load and on language changes without replacing route numbers or app labels", () => {
    const { map, apply } = fixture([
      {
        id: "settlement-label",
        type: "symbol",
        source: "base",
        layout: { "text-field": ["get", "name"] },
      },
      {
        id: "road-number-shield",
        type: "symbol",
        source: "base",
        layout: { "text-field": ["get", "ref"] },
      },
      {
        id: "cluster-count",
        type: "symbol",
        source: "items",
        layout: { "text-field": ["get", "point_count"] },
      },
      {
        id: "external-label",
        type: "symbol",
        source: "places-extra",
        layout: { "text-field": ["get", "title"] },
      },
    ]);
    apply("zh-TW");
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "settlement-label",
      "text-field",
      ["coalesce", ["get", "name_zh-Hant"], ["get", "name"]],
    );
    expect(
      map.setLayoutProperty.mock.calls.every(
        ([id]) => id === "settlement-label",
      ),
    ).toBe(true);
    expect(
      map.setPaintProperty.mock.calls.some(
        ([id]) => id === "cluster-count" || id === "external-label",
      ),
    ).toBe(false);
    apply("en");
    expect(map.setLayoutProperty).toHaveBeenLastCalledWith(
      "settlement-label",
      "text-field",
      ["coalesce", ["get", "name_en"], ["get", "name"]],
    );
  });
});
