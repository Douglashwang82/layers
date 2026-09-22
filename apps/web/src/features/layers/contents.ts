import { daysBetween, type Actor, type DateFilter } from "@taiwanhub/shared";
import type { LayerRecord } from "./repository";
import { runMapQuery, type MapCity } from "../map/query";
/** A fixed-date layer keeps its original dates; evergreen layers show upcoming timed items. */
export function layerDateFilter(layer: LayerRecord): DateFilter {
  if (layer.schedule === "day" && layer.startsOn) return layer.startsOn;
  if (
    layer.schedule === "range" &&
    layer.startsOn &&
    layer.endsOn &&
    daysBetween(layer.startsOn, layer.endsOn) <= 31
  )
    return `${layer.startsOn}..${layer.endsOn}`;
  return "upcoming";
}
/** The layer's authorized contents through the same query used by the map. */
export async function getLayerContents(
  layer: LayerRecord,
  city: MapCity,
  actor: Actor | null,
) {
  return runMapQuery(
    {
      city: city.slug,
      layers: [layer.slug],
      date: layerDateFilter(layer),
      q: "",
      scope: "layers",
      view: "list",
      page: 1,
    },
    city,
    actor,
  );
}
