import { parseMapQuery, type Actor, type MapState } from "@taiwanhub/shared";
import { getActiveCity } from "@/lib/city";
import { flags } from "@/lib/config";
import { getMapPreference } from "../layers/repository";
/**
 * The map MVP has no search: text search, city-wide scope, "search this
 * area" bounds, date filters and non-place types are ignored server-side, so
 * an old URL cannot reach them even though the UI no longer offers them.
 */
export function mvpMapState<T extends MapState>(state: T): T {
  return {
    ...state,
    q: "",
    scope: "layers",
    area: undefined,
    date: "upcoming",
    types: ["place"],
  };
}
/**
 * Explicit URL state wins over remembered defaults. Without explicit layers a
 * returning user gets their authorized active layers, otherwise the city's
 * Discover system layer (an empty map in the MVP, which has no system
 * layers). `layers=none` preserves a deliberately empty map.
 */
export async function resolveMapRequest(
  params: Record<string, string | undefined>,
  actor: Actor | null,
) {
  const parsed = parseMapQuery(params);
  const { city, cities } = await getActiveCity(params.city);
  let layers: MapState["layers"];
  let restored = false;
  if (parsed.layers !== undefined) layers = parsed.layers;
  else {
    const preference = await getMapPreference(actor?.id);
    if (preference?.layers.length) {
      layers = preference.layers;
      restored = true;
    } else layers = flags.mapMvp ? "none" : [`discover-${city.slug}`];
  }
  const state: MapState = { ...parsed, city: city.slug, layers };
  return {
    city,
    cities,
    state: flags.mapMvp ? mvpMapState(state) : state,
    restored,
  };
}
