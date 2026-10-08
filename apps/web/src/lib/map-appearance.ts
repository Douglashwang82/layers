import type { Map as MapboxMap, MapOptions } from "mapbox-gl";
import type { Locale } from "./dictionary";

/** A flat, north-up atlas. Markers have their own screen-facing perspective. */
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

export const jadePalette = {
  land: "#f0f4ef",
  park: "#dbe8d6",
  water: "#cbdfe0",
  building: "#e5ebe2",
  road: "#ffffff",
  roadEdge: "#d5ded5",
  label: "#53695d",
  ink: "#19392f",
  place: "#087f65",
  event: "#cf705b",
  content: "#dab654",
} as const;

/** Restyle only provider basemap layers; leave app sources and filters intact. */
export function applyJadeAtlas(map: MapboxMap, locale: Locale) {
  const field = locale === "zh-TW" ? "name_zh-Hant" : "name_en";
  for (const layer of map.getStyle()?.layers ?? []) {
    if (
      "source" in layer &&
      ["items", "places-extra"].includes(String(layer.source))
    )
      continue;
    if (layer.type === "fill-extrusion" || layer.type === "sky") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    } else if (layer.type === "background") {
      map.setPaintProperty(layer.id, "background-color", jadePalette.land);
    } else if (layer.type === "fill") {
      if (layer.id === "water")
        map.setPaintProperty(layer.id, "fill-color", jadePalette.water);
      else if (layer.id === "landuse")
        map.setPaintProperty(layer.id, "fill-color", [
          "match",
          ["get", "class"],
          ["park", "grass", "wood", "scrub", "national_park"],
          jadePalette.park,
          jadePalette.land,
        ]);
      else if (layer.id === "landcover")
        map.setPaintProperty(layer.id, "fill-color", jadePalette.park);
      else if (layer.id === "building")
        map.setPaintProperty(layer.id, "fill-color", jadePalette.building);
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
          /case/.test(layer.id) ? jadePalette.roadEdge : jadePalette.road,
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
        map.setPaintProperty(layer.id, "text-color", jadePalette.label);
        map.setPaintProperty(layer.id, "text-halo-color", jadePalette.land);
      }
    }
  }
}
