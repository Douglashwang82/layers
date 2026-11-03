"use client";
import type { ReactNode } from "react";
import type { LayerAvailability } from "@/features/map/query";
import { type Locale } from "@/lib/dictionary";
import { layerTitle } from "@/lib/layer-labels";
/** A stable per-layer hue, so a layer keeps its color across sessions. */
export function layerColor(slug: string) {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash} 55% 45%)`;
}
/**
 * Splits rows into one group per applied layer, in layer order. A row in
 * several layers is listed under each; rows in none of them go to `rest`.
 */
export function groupByLayer<T extends { layers: string[] }>(
  rows: T[],
  layers: LayerAvailability[] | undefined,
) {
  const known = (layers ?? []).filter((l) => l.status === "ok");
  const groups = known
    .map((layer) => ({
      layer,
      rows: rows.filter((row) => row.layers.includes(layer.slug)),
    }))
    .filter((group) => group.rows.length > 0);
  const grouped = new Set(groups.flatMap((g) => g.rows));
  return { groups, rest: rows.filter((row) => !grouped.has(row)) };
}
/** A collapsible, color-coded section of the list for one layer. */
export function LayerSection({
  layer,
  locale,
  count,
  children,
}: {
  layer: LayerAvailability;
  locale: Locale;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="layer-section" open>
      <summary>
        <span
          className="layer-swatch"
          style={{ background: layerColor(layer.slug) }}
          aria-hidden="true"
        />
        <span className="layer-section-title">{layerTitle(layer, locale)}</span>
        <span className="count-pill">{count}</span>
      </summary>
      {children}
    </details>
  );
}
