import { getCopy, getLocale } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { flags, placesClientConfig } from "@/lib/config";
import { resolveMapRequest } from "@/features/map/request";
import { runMapQuery } from "@/features/map/query";
import { redirect } from "next/navigation";
import { getMapItemDetail } from "@/features/map/detail";
import { listMapLibrary, resolveLayers } from "@/features/layers/repository";
import {
  serializeMapQuery,
  type Actor,
  type MapState,
} from "@taiwanhub/shared";
import type { MapCity } from "@/features/map/query";
const ignoredByMvp = ["q", "scope", "area", "date", "types"] as const;
/** The MVP's canonical map URL when the requested one carries what it ignores; null when already canonical. */
async function mvpCanonicalUrl(
  params: Record<string, string | undefined>,
  state: MapState,
  city: MapCity,
  actor: Actor | null,
) {
  // Remembered layers never come from the URL; the map query already drops
  // their disabled entries, so only explicit URL layers are rewritten.
  const explicit =
    params.layers === undefined || state.layers === "none" ? [] : state.layers;
  const { disabled } = await resolveLayers(explicit, actor, city);
  if (
    !disabled.length &&
    !ignoredByMvp.some((key) => params[key] !== undefined)
  )
    return null;
  const layers = explicit.filter((slug) => !disabled.includes(slug));
  // Only what the MVP honours: city, layers, the selected item and the view.
  return (
    "/" +
    serializeMapQuery(
      {
        city: state.city,
        layers:
          params.layers === undefined
            ? undefined
            : layers.length
              ? layers
              : "none",
        item: state.item,
        view: state.view,
      },
      { includeCity: params.city !== undefined },
    )
  );
}
import { MapWorkspace } from "@/components/map/map-workspace";
import { LegacyHome } from "@/components/home/legacy-home";
/**
 * The canonical map workspace. Layers, results and the selected item are
 * server-rendered for the validated URL state so the list is useful before the
 * map provider is ready, on slow devices, and when the provider fails.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (!flags.mapHome) return <LegacyHome />;
  const [params, t, locale, actor] = await Promise.all([
    searchParams,
    getCopy(),
    getLocale(),
    currentActor(),
  ]);
  const { city, state } = await resolveMapRequest(params, actor);
  if (flags.mapMvp) {
    // The URL is the client's source of truth: drop what the MVP ignores
    // (search, filters, area, disabled system layers) instead of showing it.
    const canonical = await mvpCanonicalUrl(params, state, city, actor);
    if (canonical) redirect(canonical);
  }
  const [result, detail, library] = await Promise.all([
    runMapQuery(state, city, actor),
    state.item
      ? getMapItemDetail(state.item, actor).catch(() => null)
      : Promise.resolve(null),
    // The MVP picker lists the member's own, group and followed layers.
    flags.mapMvp && actor ? listMapLibrary(actor, city) : Promise.resolve(null),
  ]);
  return (
    <MapWorkspace
      initial={result}
      initialDetail={detail}
      city={city}
      t={t}
      locale={locale}
      authenticated={!!actor}
      token={process.env.NEXT_PUBLIC_MAPBOX_TOKEN || undefined}
      hasDemo={result.items.some((item) => item.isDemo)}
      contentEnabled={flags.content}
      layerWrites={flags.layerWrites}
      places={placesClientConfig()}
      library={
        library &&
        library.map(({ layer }) => ({
          slug: layer.slug,
          title: layer.title,
          titleChinese: layer.titleChinese,
          ownerKind: layer.ownerKind,
          ownerName: layer.ownerName,
          audience: layer.audience,
          schedule: layer.schedule,
          startsOn: layer.startsOn,
          endsOn: layer.endsOn,
          status: "ok" as const,
          count: layer.itemCount,
        }))
      }
    />
  );
}
