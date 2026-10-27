import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getLocale } from "@/lib/i18n";
import { mapImportEn, mapImportZh } from "@/lib/map-import-copy";
import { flags } from "@/lib/config";
import { getCities } from "@/features/catalog/repository";
import { listEditableLayers } from "@/features/layers/repository";
import { listEditableGroups } from "@/features/groups/repository";
import { MapImportForm } from "@/components/layers/map-import-form";
export const metadata = {
  title: "Import a shared map",
  robots: { index: false },
};
export default async function MapImportPage({
  searchParams,
}: {
  searchParams: Promise<{ layer?: string }>;
}) {
  if (!flags.layerWrites || !flags.layerCustomPlaces) notFound();
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?next=/map-import");
  const [locale, cities, editable, groups, query] = await Promise.all([
    getLocale(),
    getCities(),
    listEditableLayers(actor),
    listEditableGroups(actor.id),
    searchParams,
  ]);
  const t = locale === "zh-TW" ? mapImportZh : mapImportEn;
  const layers = editable.filter((l) => l.audience !== "public");
  return (
    <div className="container">
      <nav>
        <Link href="/layers">{t.back}</Link> ·{" "}
        <Link href="/layer-collections">{t.collections}</Link>
      </nav>
      <h1>{t.title}</h1>
      <MapImportForm
        t={t}
        cities={cities}
        layers={layers.map((l) => ({
          id: l.id,
          title: l.title,
          citySlug: l.citySlug,
          revision: l.revision,
        }))}
        groups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          cityId: g.cityId,
        }))}
        initialLayer={
          layers.some((l) => l.id === query.layer) ? query.layer : undefined
        }
      />
    </div>
  );
}
