import type { Map as MapboxMap, MapOptions } from "mapbox-gl";
import type { Locale } from "./dictionary";

/** A flat, north-up atlas. */
export const flatMapOptions = {
  projection: { name: "mercator" },
  pitch: 0,
  minPitch: 0,
  maxPitch: 0,
  bearing: 0,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
} satisfies Partial<MapOptions>;

/**
 * Warm, low-saturation atlas for the map home. The basemap stays quiet; app
 * markers, text and controls keep the stronger values (never a CSS filter).
 */
export const jadePalette = {
  land: "#f3f3f3",
  park: "#e6e6e6",
  water: "#d4d4d4",
  building: "#ececec",
  road: "#ffffff",
  roadEdge: "#d9d9d9",
  boundary: "#cccccc",
  label: "#5c5c5c",
  surface: "#ffffff",
  ink: "#111111",
  primary: "#111111",
  place: "#111111",
  event: "#5c5c5c",
  content: "#8a8a8a",
} as const;

export type AtlasPalette = { [K in keyof typeof jadePalette]: string };
export type AtlasTheme = "light" | "dark";

/** The dark atlas: same structure, inverted emphasis (docs/design/jade-atlas-dark.md). */
export const jadeDarkPalette: AtlasPalette = {
  land: "#1b1c1e",
  park: "#232528",
  water: "#12202c",
  building: "#232427",
  road: "#3f4247",
  roadEdge: "#141517",
  boundary: "#505358",
  label: "#a9acb1",
  surface: "#26272a",
  ink: "#f2f2f2",
  primary: "#f2f2f2",
  place: "#f2f2f2",
  event: "#b0b0b0",
  content: "#8a8a8a",
};

export const atlasPalettes: Record<AtlasTheme, AtlasPalette> = {
  light: jadePalette,
  dark: jadeDarkPalette,
};

export const atlasStyles: Record<AtlasTheme, string> = {
  light: "mapbox://styles/mapbox/light-v11",
  dark: "mapbox://styles/mapbox/dark-v11",
};

/**
 * Detail appears as the user zooms in: a style layer is never shown earlier
 * than these zooms, and keeps any later minimum the provider style set.
 */
const minZoomByLayer: [RegExp, number][] = [
  [/^(settlement-subdivision|settlement-minor)-label/, 12],
  [/^(natural|water|waterway)-.*label/, 13],
  [/^(road-label|road-intersection)/, 14],
  [/^(road|bridge|tunnel)-(minor|street|service|path|pedestrian|steps)/, 14],
];

/** Restyle only provider basemap layers; leave app sources and filters intact. */
export function applyJadeAtlas(
  map: MapboxMap,
  locale: Locale,
  theme: AtlasTheme = "light",
) {
  const palette = atlasPalettes[theme];
  const field = locale === "zh-TW" ? "name_zh-Hant" : "name_en";
  for (const layer of map.getStyle()?.layers ?? []) {
    if (
      "source" in layer &&
      ["items", "places-extra", "selected-item", "hover-item"].includes(
        String(layer.source),
      )
    )
      continue;
    const floor = minZoomByLayer.find(([pattern]) => pattern.test(layer.id));
    if (floor)
      map.setLayerZoomRange(
        layer.id,
        Math.max(layer.minzoom ?? 0, floor[1]),
        layer.maxzoom ?? 24,
      );
    if (layer.type === "fill-extrusion" || layer.type === "sky") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    } else if (layer.type === "background") {
      map.setPaintProperty(layer.id, "background-color", palette.land);
    } else if (layer.type === "fill") {
      if (layer.id === "water")
        map.setPaintProperty(layer.id, "fill-color", palette.water);
      else if (layer.id === "landuse")
        map.setPaintProperty(layer.id, "fill-color", [
          "match",
          ["get", "class"],
          ["park", "grass", "wood", "scrub", "national_park"],
          palette.park,
          palette.land,
        ]);
      else if (layer.id === "landcover")
        map.setPaintProperty(layer.id, "fill-color", palette.park);
      else if (layer.id === "building")
        map.setPaintProperty(layer.id, "fill-color", palette.building);
    } else if (layer.type === "line" && /^admin-/.test(layer.id)) {
      map.setPaintProperty(layer.id, "line-color", palette.boundary);
    } else if (
      layer.type === "line" &&
      /^(road|bridge|tunnel)-/.test(layer.id)
    ) {
      // Preserve rail, pedestrian and traffic semantics and all width expressions.
      if (
        /(primary|secondary|street|motorway|trunk|minor|service)/.test(layer.id)
      )
        map.setPaintProperty(
          layer.id,
          "line-color",
          /case/.test(layer.id) ? palette.roadEdge : palette.road,
        );
    } else if (layer.type === "symbol") {
      if (/^(poi-|transit-)/.test(layer.id)) {
        map.setLayoutProperty(layer.id, "visibility", "none");
        continue;
      }
      if (layer.layout && "text-field" in layer.layout) {
        // Road shields contain route numbers, not translated place names.
        if (!/road-number|road-shield/.test(layer.id))
          map.setLayoutProperty(layer.id, "text-field", [
            "coalesce",
            ["get", field],
            ["get", "name"],
          ]);
        map.setPaintProperty(layer.id, "text-color", palette.label);
        map.setPaintProperty(layer.id, "text-halo-color", palette.land);
      }
    }
  }
}
