import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getLocale } from "@/lib/i18n";
import { flags } from "@/lib/config";
import { mapImportEn, mapImportZh } from "@/lib/map-import-copy";
import { listCollections } from "@/features/layers/collections";
import type { CollectionChild } from "@/features/layers/collections-types";
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
  const [mine, groups] = await Promise.all([
    listCollections("mine", actor),
    listCollections("groups", actor),
  ]);
  const seen = new Set<string>();
  const collections = [...mine, ...groups].filter(
    (c) => !seen.has(c.id) && !!seen.add(c.id),
  );
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
          layers: flatLayers(c.children).map((l) => ({
            id: l.id,
            slug: l.slug,
            title: l.title,
          })),
        }))}
      />
    </div>
  );
}

/** The folder's layers in tree order, sub-folders included, without repeats. */
function flatLayers(children: CollectionChild[]) {
  const seen = new Set<string>();
  const layers: Extract<CollectionChild, { kind: "layer" }>["layer"][] = [];
  const walk = (list: CollectionChild[]) => {
    for (const child of list)
      if (child.kind === "folder") walk(child.folder.children);
      else if (!seen.has(child.layer.id)) {
        seen.add(child.layer.id);
        layers.push(child.layer);
      }
  };
  walk(children);
  return layers;
}
