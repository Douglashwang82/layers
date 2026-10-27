import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getLocale } from "@/lib/i18n";
import { flags } from "@/lib/config";
import { mapImportEn, mapImportZh } from "@/lib/map-import-copy";
import { listCollections } from "@/features/map-import/service";
import { CollectionList } from "@/components/layers/collection-list";
export const metadata = {
  title: "Layer collections",
  robots: { index: false },
};
export default async function CollectionsPage() {
  if (!flags.layerCustomPlaces) notFound();
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?next=/layer-collections");
  const t = (await getLocale()) === "zh-TW" ? mapImportZh : mapImportEn;
  const collections = await listCollections(actor);
  return (
    <div className="container">
      <nav>
        <Link href="/layers">{t.back}</Link>
        {flags.layerWrites && (
          <>
            {" "}
            · <Link href="/map-import">{t.title}</Link>
          </>
        )}
      </nav>
      <h1>{t.collections}</h1>
      <CollectionList
        t={t}
        collections={collections.map((c) => ({
          id: c.id,
          title: c.title,
          layers: c.layers.map((l) => ({
            id: l.id,
            slug: l.slug,
            title: l.title,
            citySlug: l.citySlug,
          })),
        }))}
      />
    </div>
  );
}
