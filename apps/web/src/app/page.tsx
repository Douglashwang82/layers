import { getCopy, getLocale } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { flags, placesClientConfig } from "@/lib/config";
import { resolveMapRequest } from "@/features/map/request";
import { runMapQuery } from "@/features/map/query";
import { redirect } from "next/navigation";
import { LayerWorkspaceScreen } from "@/components/layers/workspace-screen";
import { layerPanelKeys } from "@/lib/layer-workspace";
import { getMapItemDetail } from "@/features/map/detail";
import { listMapLibrary, resolveLayers } from "@/features/layers/repository";
import { listMapCollections } from "@/features/layers/collections";
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
        // Like layers, folders come from the URL only when it names them.
        collections:
          params.collections === undefined ? undefined : state.collections,
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
  // The URL is the client's source of truth: drop what the map ignores
  // (search, filters, area, disabled system layers) instead of showing it.
  const canonical = await mvpCanonicalUrl(params, state, city, actor);
  if (canonical) {
    const url = new URL(canonical, "https://local.invalid");
    for (const key of layerPanelKeys)
      if (params[key] !== undefined) url.searchParams.set(key, params[key]!);
    redirect(url.pathname + url.search);
  }
  const [result, detail, library, folders] = await Promise.all([
    runMapQuery(state, city, actor),
    state.item
      ? getMapItemDetail(state.item, actor).catch(() => null)
      : Promise.resolve(null),
    // The picker lists the member's own, group and followed layers.
    actor ? listMapLibrary(actor, city) : Promise.resolve(null),
    // Folders take map slots like layers do.
    actor ? listMapCollections(actor, city) : Promise.resolve([]),
  ]);
  return (
    <MapWorkspace
      layerScreen={<LayerWorkspaceScreen params={params} />}
      initial={result}
      initialDetail={detail}
      city={city}
      t={t}
      locale={locale}
      authenticated={!!actor}
      token={process.env.NEXT_PUBLIC_MAPBOX_TOKEN || undefined}
      hasDemo={result.items.some((item) => item.isDemo)}
      layerWrites={flags.layerWrites}
      places={placesClientConfig()}
      folders={folders}
      library={
        library &&
        library.map(({ layer, access }) => ({
          slug: layer.slug,
          id: layer.id,
          canEdit: access.edit,
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
