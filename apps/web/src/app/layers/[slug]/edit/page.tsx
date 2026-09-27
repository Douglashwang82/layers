import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCopy, getLocale } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import { getLayer } from "@/features/layers/repository";
import { getLayerContents } from "@/features/layers/contents";
import { getCities } from "@/features/catalog/repository";
import { LayerEditor } from "@/components/layers/layer-editor";
import { layerTitle } from "@/lib/layer-labels";
export const metadata: Metadata = {
  title: "Edit layer",
  robots: { index: false },
};
export default async function EditLayerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [{ slug }, actor] = await Promise.all([params, currentActor()]);
  if (!flags.layerWrites) redirect(`/layers/${slug}`);
  if (!actor)
    redirect("/sign-in?next=" + encodeURIComponent(`/layers/${slug}/edit`));
  const found = await getLayer(slug, actor);
  if (!found || !found.access.edit) notFound();
  const { layer } = found;
  const [t, locale, cities] = await Promise.all([
    getCopy(),
    getLocale(),
    getCities(),
  ]);
  const cityRow = cities.find((c) => c.id === layer.cityId);
  const city = {
    id: layer.cityId,
    slug: layer.citySlug,
    name: layer.cityName,
    timezone: layer.timezone,
    latitude: 0,
    longitude: 0,
  };
  const contents = await getLayerContents(layer, city, actor);
  return (
    <div className="container">
      <nav className="breadcrumbs" aria-label={t.back}>
        <Link href={`/layers/${layer.slug}`}>
          ← {layerTitle(layer, locale)}
        </Link>
      </nav>
      <LayerEditor
        mode="edit"
        layer={layer}
        items={contents.items}
        city={{
          slug: layer.citySlug,
          name: layer.cityName,
          timezone: layer.timezone,
        }}
        groups={[]}
        canSuggestPlace={flags.submissions}
        canCreatePlaces={flags.layerCustomPlaces}
        mapToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN || undefined}
        cityCenter={
          cityRow
            ? { latitude: cityRow.latitude, longitude: cityRow.longitude }
            : undefined
        }
        t={t}
        locale={locale}
      />
    </div>
  );
}
