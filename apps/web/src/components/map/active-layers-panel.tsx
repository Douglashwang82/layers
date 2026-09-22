"use client";
import Link from "next/link";
import { Plus, Layers as LayersIcon } from "lucide-react";
import type { LayerAvailability } from "@/features/map/query";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { maxAppliedLayers } from "@taiwanhub/shared";
import { layerTitle, ownerLabel, scheduleLabel } from "@/lib/layer-labels";
/**
 * Applied layers with their checkbox, owner, schedule, availability and the
 * count they contribute to the current query. Hidden layers stay listed for
 * the session so hiding is reversible without a trip to the library.
 */
export function ActiveLayersPanel({
  layers,
  hidden,
  t,
  locale,
  refreshing,
  onToggle,
  onOnly,
}: {
  layers: LayerAvailability[];
  hidden: LayerAvailability[];
  t: Copy;
  locale: Locale;
  refreshing: boolean;
  onToggle: (slug: string, applied: boolean) => void;
  onOnly: (slug: string) => void;
}) {
  const applied = layers.length;
  const rows = [
    ...layers.map((l) => ({ layer: l, applied: true })),
    ...hidden.map((l) => ({ layer: l, applied: false })),
  ];
  return (
    <section className="active-layers" aria-labelledby="active-layers-heading">
      <div className="panel-heading">
        <h2 id="active-layers-heading">
          <LayersIcon size={18} aria-hidden="true" />
          {t.onYourMap}
        </h2>
        <span className="count-pill">{applied}</span>
      </div>
      {rows.length === 0 && <p className="muted">{t.chooseLayer}</p>}
      <ul className="layer-rows">
        {rows.map(({ layer, applied: isApplied }) => (
          <li key={layer.slug} className={`layer-row status-${layer.status}`}>
            <label className="layer-toggle">
              <input
                type="checkbox"
                checked={isApplied}
                disabled={
                  layer.status === "unavailable" ||
                  (!isApplied && applied >= maxAppliedLayers)
                }
                onChange={(e) => onToggle(layer.slug, e.target.checked)}
                aria-describedby={`layer-${layer.slug}-meta`}
              />
              <span className="layer-text">
                <span className="layer-title">
                  {layer.status === "unavailable"
                    ? t.layerUnavailable
                    : layerTitle(layer, locale)}
                </span>
                <span className="layer-meta" id={`layer-${layer.slug}-meta`}>
                  {layer.status === "other-city"
                    ? format(t.layerOtherCity, { city: layer.cityName ?? "" })
                    : layer.status === "ok"
                      ? `${ownerLabel(layer, t, false)} · ${scheduleLabel(layer, t, locale)}`
                      : ""}
                </span>
              </span>
              {layer.status === "ok" && (
                <span
                  className="layer-count th-tabular"
                  aria-busy={refreshing || undefined}
                >
                  {isApplied ? layer.count : t.layerNotApplied}
                </span>
              )}
            </label>
            {layer.status === "ok" && (
              <span className="layer-actions">
                <Link className="text-button" href={`/layers/${layer.slug}`}>
                  {t.viewLayer}
                </Link>
                {isApplied && applied > 1 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onOnly(layer.slug)}
                  >
                    {t.showOnlyThis}
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {applied >= maxAppliedLayers && (
        <p className="fine-print">
          {format(t.layerLimit, { max: maxAppliedLayers })}
        </p>
      )}
      <Link className="button secondary small find-layers" href="/layers">
        <Plus size={16} aria-hidden="true" />
        {t.findLayers}
      </Link>
    </section>
  );
}
