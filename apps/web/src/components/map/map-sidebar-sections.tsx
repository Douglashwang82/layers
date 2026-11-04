"use client";
import { useMemo, type ReactNode } from "react";
import {
  CalendarDays,
  Folder as FolderIcon,
  Info,
  SlidersHorizontal,
} from "lucide-react";
import { maxAppliedLayers, type LayerEvent } from "@taiwanhub/shared";
import { LayerLink as Link } from "../layers/workspace-navigation";
import { layerColor } from "@/components/map/layer-section";
import type { CollectionNode } from "@/features/layers/collections-types";
import type { LayerAvailability, MapQueryResult } from "@/features/map/query";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { eventRange, eventTitle } from "@/lib/event-time";
import { layerTitle } from "@/lib/layer-labels";

/** Applied folders and layers as quick toggles above the list. */
export function LayerChips({
  folders,
  collections,
  shownFolders,
  shownSlugs,
  layers,
  slotsUsed,
  t,
  locale,
  onToggleFolder,
  onToggleLayer,
  onManage,
}: {
  folders: CollectionNode[];
  collections: MapQueryResult["collections"];
  shownFolders: string[];
  shownSlugs: string[];
  /** Applied layers, then the ones hidden this session. */
  layers: LayerAvailability[];
  slotsUsed: number;
  t: Copy;
  locale: Locale;
  onToggleFolder: (slug: string, applied: boolean) => void;
  onToggleLayer: (slug: string, applied: boolean) => void;
  onManage: () => void;
}) {
  const folderTitles = useMemo(() => {
    const map = new Map<string, CollectionNode>();
    const walk = (nodes: CollectionNode[]) => {
      for (const node of nodes) {
        map.set(node.slug, node);
        walk(
          node.children.flatMap((c) => (c.kind === "folder" ? [c.folder] : [])),
        );
      }
    };
    walk(folders);
    return map;
  }, [folders]);
  return (
    <div className="layer-chips-bar">
      <div className="layer-chips" role="group" aria-label={t.onYourMap}>
        {shownFolders.map((slug) => {
          const named =
            folderTitles.get(slug) ?? collections?.find((c) => c.slug === slug);
          const name = named
            ? locale === "zh-TW" && named.titleChinese
              ? named.titleChinese
              : named.title
            : "";
          return (
            <button
              key={`folder:${slug}`}
              type="button"
              className="layer-chip"
              aria-pressed
              aria-label={format(t.folderHideFromMap, {
                title: name || t.folderUnavailable,
              })}
              onClick={() => onToggleFolder(slug, false)}
            >
              <FolderIcon size={14} aria-hidden="true" />
              {name || t.folderUnavailable}
            </button>
          );
        })}
        {layers
          .filter((l) => l.status === "ok")
          .map((layer) => {
            const on = shownSlugs.includes(layer.slug);
            return (
              <button
                key={layer.slug}
                type="button"
                className="layer-chip"
                aria-pressed={on}
                disabled={!on && slotsUsed >= maxAppliedLayers}
                onClick={() => onToggleLayer(layer.slug, !on)}
              >
                <span
                  className="layer-swatch"
                  style={{ background: layerColor(layer.slug) }}
                  aria-hidden="true"
                />
                {layerTitle(layer, locale)}
              </button>
            );
          })}
      </div>
      <button type="button" className="layer-chip manage" onClick={onManage}>
        <SlidersHorizontal size={14} aria-hidden="true" />
        {t.manageLayers}
      </button>
    </div>
  );
}

/** The result count and what limits it, with the list's one action beside it. */
export function ResultsSummary({
  result,
  refreshing,
  placeCount,
  cityName,
  previousArea,
  pendingPlaces,
  shownPlaces,
  placesFailed,
  onRetryPlaces,
  action,
  t,
}: {
  result: MapQueryResult;
  refreshing: boolean;
  placeCount: number;
  cityName: string;
  /** Results still show an earlier area while the map has moved on. */
  previousArea: boolean;
  /** Google places shown without a pin. */
  pendingPlaces: number;
  shownPlaces: number;
  placesFailed: boolean;
  onRetryPlaces: () => void;
  action: ReactNode;
  t: Copy;
}) {
  return (
    <div className="results-summary">
      <div className="results-summary-row">
        <p className="result-count" role="status" aria-live="polite">
          {refreshing
            ? t.previousResults
            : format(t.resultsInArea, { count: placeCount })}
          {!refreshing && result.unmapped > 0 && (
            <small>
              {" "}
              ·{" "}
              {format(t.mappedSummary, {
                mapped: result.mapped,
                unmapped: result.unmapped,
              })}
            </small>
          )}
        </p>
        {action}
      </div>
      {result.searchScope === "city" && (
        <p className="fine-print">
          {format(t.searchOverlay, { city: cityName })}
        </p>
      )}
      {previousArea && <p className="fine-print">{t.previousArea}</p>}
      {result.truncated && <p className="fine-print">{t.zoomIn}</p>}
      {pendingPlaces > 0 && (
        <p className="fine-print" role="status">
          {format(t.externalSummary, {
            count: shownPlaces,
            pending: pendingPlaces,
          })}
        </p>
      )}
      {placesFailed && (
        <p className="message error-message" role="alert">
          {t.error}{" "}
          <button type="button" className="text-button" onClick={onRetryPlaces}>
            {t.retry}
          </button>
        </p>
      )}
    </div>
  );
}

/** The sign-in prompt or first-run starter for a map with nothing on it. */
export function MapEmptyState({
  firstRun,
  dailyPickSlug,
  t,
  onSeePick,
}: {
  /** A signed-in member with no layers of their own gets a starter. */
  firstRun: boolean;
  dailyPickSlug: string | null;
  t: Copy;
  onSeePick: (slug: string) => void;
}) {
  if (firstRun)
    return (
      <div className="empty first-run-starter">
        <h3>{t.starterTitle}</h3>
        <p>{t.starterBody}</p>
        <div className="actions">
          {dailyPickSlug && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => onSeePick(dailyPickSlug)}
            >
              {t.starterSeePick}
            </button>
          )}
          <Link className="button small" href="/layers/new">
            {t.starterStartLayer}
          </Link>
        </div>
        <p className="fine-print">{t.starterJoinGroup}</p>
      </div>
    );
  return (
    <div className="empty">
      <h3>{t.mvpEmptyTitle}</h3>
      <p>{t.signInForLayers}</p>
      <div className="actions">
        <Link className="button small" href="/sign-in?next=%2F">
          {t.signIn}
        </Link>
      </div>
    </div>
  );
}

/** Upcoming events at the open place. */
export function AttachedEvents({
  events,
  locale,
  timeZone,
  t,
}: {
  events: LayerEvent[] | undefined;
  locale: Locale;
  timeZone: string;
  t: Copy;
}) {
  if (!events?.length) return null;
  return (
    <section className="attached-events" aria-labelledby="attached-events">
      <h3 id="attached-events">
        <CalendarDays size={16} aria-hidden="true" /> {t.upcomingEvents}
      </h3>
      <ul className="event-list">
        {events.map((event) => (
          <li key={event.id}>
            <span className="event-when">
              {eventRange(event, locale, timeZone)}
            </span>
            <b>{eventTitle(event, locale)}</b>
            {event.note && <span className="muted">{event.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The demo notice and the About text, at the end of every screen. */
export function SidebarFooter({ hasDemo, t }: { hasDemo: boolean; t: Copy }) {
  return (
    <div className="map-footer">
      {hasDemo && (
        <details className="map-demo">
          <summary>{t.demoNotice}</summary>
          <p>{t.demo}</p>
        </details>
      )}
      <details className="map-about">
        <summary>
          <Info size={14} aria-hidden="true" /> {t.aboutHelp}
        </summary>
        <p>{t.footer}</p>
        <p>
          <small>{t.footerSmall}</small>
        </p>
        <p>
          <small>
            {t.layerWord}: {t.layerHelp}
          </small>
        </p>
        <p>
          <small>{t.keyboardHint}</small>
        </p>
        <p>
          <small>{t.attribution}</small>
        </p>
      </details>
    </div>
  );
}
