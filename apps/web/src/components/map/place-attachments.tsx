"use client";
import { useState } from "react";
import type { LayerEvent } from "@taiwanhub/shared";
import { LayerItemEvents } from "@/components/layers/layer-item-events";
import {
  LayerItemReviews,
  useLayerItemRatings,
} from "@/components/layers/layer-item-reviews";
import { layerColor } from "@/components/map/layer-section";
import { LayerItemMarker } from "@/components/markers/marker-editor";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { layerTitle } from "@/lib/layer-labels";
import type { LayerAvailability } from "@/features/map/query";

const mySavesSlug = "my-saves";

/**
 * Events and tips for the selected place, attached in the map itself: one
 * block per shown layer that holds the place. Editors add or change events;
 * members leave tips (ratings and comments) unless the details below already
 * offer them (Google places: the business panel's layer-scoped reviews). The
 * server decides who may write; hiding a control here is only a convenience.
 */
export function PlaceAttachments({
  placeKey,
  placeName,
  layers,
  events,
  city,
  layerWrites,
  tips,
  t,
  locale,
  onEventsChanged,
}: {
  placeKey: string;
  placeName: string;
  layers: LayerAvailability[];
  /** Upcoming events at this place across the shown layers. */
  events: LayerEvent[];
  city: { name: string; timezone: string };
  layerWrites: boolean;
  /** Show the tips (ratings and comments) form here. */
  tips: boolean;
  t: Copy;
  locale: Locale;
  /** Called after an event write so the map can refresh its pins and lists. */
  onEventsChanged: () => void;
}) {
  // Daily Pick and My saves are projections without curated items.
  const candidates = layers.filter(
    (l) =>
      l.status === "ok" &&
      !!l.id &&
      l.ownerKind !== "system" &&
      l.slug !== mySavesSlug,
  );
  if (!candidates.length) return null;
  return (
    <div className="place-attachments">
      {candidates.map((layer) => (
        <LayerAttachment
          key={layer.slug}
          layer={layer}
          placeKey={placeKey}
          placeName={placeName}
          events={events.filter((e) => e.layer === layer.slug)}
          city={city}
          layerWrites={layerWrites}
          tips={tips}
          t={t}
          locale={locale}
          onEventsChanged={onEventsChanged}
        />
      ))}
    </div>
  );
}

function LayerAttachment({
  layer,
  placeKey,
  placeName,
  events,
  city,
  layerWrites,
  tips,
  t,
  locale,
  onEventsChanged,
}: {
  layer: LayerAvailability;
  placeKey: string;
  placeName: string;
  events: LayerEvent[];
  city: { name: string; timezone: string };
  layerWrites: boolean;
  tips: boolean;
  t: Copy;
  locale: Locale;
  onEventsChanged: () => void;
}) {
  // Item ids by place key: tells whether this layer holds the place.
  const { ids, markers, available } = useLayerItemRatings(layer.id);
  // A save shows at once; once the map query refreshes, its events win again.
  const signature = events
    .map((e) => [e.id, e.title, e.startTime, e.endTime, e.note].join("~"))
    .join("|");
  const [local, setLocal] = useState<{
    base: string;
    events: LayerEvent[];
  } | null>(null);
  const shown = local?.base === signature ? local.events : events;
  const itemId = ids.get(placeKey);
  const canAddEvents = !!layer.canEdit && layerWrites;
  if (!available || !itemId || (!canAddEvents && !tips)) return null;
  const title = layerTitle(layer, locale);
  const headingId = `attach-${layer.slug}`;
  return (
    <section className="place-attachment" aria-labelledby={headingId}>
      <h3 id={headingId}>
        <span
          className="layer-swatch"
          style={{ background: layerColor(layer.slug) }}
          aria-hidden="true"
        />
        {format(tips ? t.placeInLayer : t.placeEventsInLayer, {
          layer: title,
        })}
      </h3>
      {canAddEvents && (
        <LayerItemMarker
          layerId={layer.id!}
          itemId={itemId}
          layerTitle={title}
          current={markers.get(itemId) ?? null}
          t={t}
        />
      )}
      {canAddEvents && (
        <LayerItemEvents
          layerId={layer.id!}
          itemKey={placeKey}
          itemName={placeName}
          events={shown}
          city={city}
          t={t}
          locale={locale}
          onChange={(next) => {
            setLocal({ base: signature, events: next });
            onEventsChanged();
          }}
        />
      )}
      {tips && (
        <LayerItemReviews
          layerId={layer.id!}
          itemId={itemId}
          itemName={placeName}
          t={t}
          locale={locale}
        />
      )}
    </section>
  );
}
