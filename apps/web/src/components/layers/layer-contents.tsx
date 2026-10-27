"use client";
import { useLayerRouter as useRouter } from "./workspace-navigation";
import { useContext } from "react";
import { LayerWorkspaceContext } from "./workspace-navigation";
import type { MapItem } from "@/features/map/query";
import type { Copy, Locale } from "@/lib/dictionary";
import { ResultRow } from "@/components/map/map-results";
/** Contents select an item while preserving the map's other applied layers. */
export function LayerContentsList({
  items,
  slug,
  t,
  locale,
}: {
  items: MapItem[];
  slug: string;
  t: Copy;
  locale: Locale;
}) {
  const router = useRouter();
  const workspace = useContext(LayerWorkspaceContext);
  return (
    <ul className="layer-contents">
      {items.map((item) => (
        <ResultRow
          key={item.key}
          item={item}
          t={t}
          locale={locale}
          selected={false}
          showNote
          onSelect={(key) =>
            workspace
              ? workspace.selectItem(key, slug)
              : router.push(`/?layers=${slug}&item=${encodeURIComponent(key)}`)
          }
        />
      ))}
    </ul>
  );
}
