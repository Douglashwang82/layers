"use client";
import { useLayerRouter as useRouter } from "./workspace-navigation";
import { useContext } from "react";
import { LayerWorkspaceContext } from "./workspace-navigation";
import type { MapItem } from "@/features/map/query";
import type { Copy, Locale } from "@/lib/dictionary";
import { ResultRow, itemTitle } from "@/components/map/map-results";
import {
  LayerItemRatingBadge,
  LayerItemReviews,
  useLayerItemRatings,
} from "./layer-item-reviews";
/** Contents select an item while preserving the map's other applied layers. */
export function LayerContentsList({
  items,
  slug,
  t,
  locale,
  layerId,
}: {
  items: MapItem[];
  slug: string;
  /** Enables per-item ratings and comments. */
  layerId?: string;
  t: Copy;
  locale: Locale;
}) {
  const router = useRouter();
  const workspace = useContext(LayerWorkspaceContext);
  const { ids, ratings, available } = useLayerItemRatings(layerId ?? "");
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
          extra={
            layerId && available && ids.get(item.key) ? (
              <>
                <LayerItemRatingBadge
                  rating={ratings[ids.get(item.key)!]}
                  t={t}
                />
                <LayerItemReviews
                  layerId={layerId}
                  itemId={ids.get(item.key)!}
                  itemName={itemTitle(item, locale)}
                  t={t}
                  locale={locale}
                />
              </>
            ) : null
          }
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
