import { getCopy, getLocale } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import { resolveMapRequest } from "@/features/map/request";
import { runMapQuery } from "@/features/map/query";
import { getMapItemDetail } from "@/features/map/detail";
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
  const { city, state, restored } = await resolveMapRequest(params, actor);
  const [result, detail] = await Promise.all([
    runMapQuery(state, city, actor),
    state.item
      ? getMapItemDetail(state.item, actor).catch(() => null)
      : Promise.resolve(null),
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
      restored={restored}
      contentEnabled={flags.content}
      layerWrites={flags.layerWrites}
    />
  );
}
