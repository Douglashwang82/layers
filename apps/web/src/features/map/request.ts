import { parseMapQuery, type Actor, type MapState } from "@taiwanhub/shared";
import { getActiveCity } from "@/lib/city";
import { getMapPreference } from "../layers/repository";
/**
 * Explicit URL state wins over remembered defaults. Without explicit layers a
 * returning user gets their authorized active layers, otherwise the city's
 * Discover system layer. `layers=none` preserves a deliberately empty map.
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
    } else layers = [`discover-${city.slug}`];
  }
  const state: MapState = { ...parsed, city: city.slug, layers };
  return { city, cities, state, restored };
}
