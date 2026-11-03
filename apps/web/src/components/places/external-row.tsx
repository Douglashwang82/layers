"use client";
import { MapPin } from "lucide-react";
import type { LayerEvent } from "@taiwanhub/shared";
import { NextEvent, TabelogLink } from "@/components/map/map-results";
import type { Copy, Locale } from "@/lib/dictionary";
import { googleTabelogLink } from "@/lib/tabelog";
import { GoogleMapsLink } from "./google-maps-link";
import { LocalNote } from "./local-note";
import type { ExternalRowData } from "./use-external-references";

/** A Google place in the list, in the same row shell as catalog places. */
export function ExternalRow({
  row,
  selected,
  events,
  t,
  locale,
  timeZone,
  onSelect,
}: {
  row: ExternalRowData;
  selected: boolean;
  events?: LayerEvent[];
  t: Copy;
  locale: Locale;
  timeZone: string;
  onSelect: (row: ExternalRowData) => void;
}) {
  const tabelog = row.name ? googleTabelogLink(row) : null;
  return (
    <li
      className={`external-row ${selected ? "selected" : ""}`}
      onClick={(event) => {
        // The whole row opens the place; links and buttons keep their own action.
        if ((event.target as HTMLElement).closest("a, button")) return;
        onSelect(row);
      }}
    >
      <span className="row-thumb">
        <MapPin size={20} aria-hidden="true" />
      </span>
      <div className="row-body">
        <h3 className="row-title">{row.name || t.routeGooglePlace}</h3>
        {(!row.location || row.isDailyPick) && (
          <span className="row-tags">
            {!row.location && (
              <span className="chip">{t.awaitingLocation}</span>
            )}
            {row.isDailyPick && <span className="badge">{t.dailyPick}</span>}
          </span>
        )}
        <NextEvent events={events} locale={locale} timeZone={timeZone} />
        <LocalNote note={row.localNote} t={t} />
        <span className="row-actions">
          <button
            type="button"
            className="text-button"
            aria-current={selected || undefined}
            onClick={() => onSelect(row)}
          >
            {t.openPlacePage}
          </button>
          {row.providerPlaceId && (
            <GoogleMapsLink
              placeId={row.providerPlaceId}
              name={row.name}
              t={t}
            />
          )}
          {row.name && (
            <TabelogLink
              name={row.name}
              href={tabelog}
              t={t}
              className="row-tabelog external-tabelog"
            />
          )}
        </span>
      </div>
    </li>
  );
}
