"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  googleMarkerKind,
  withinBounds,
  type Bounds,
  type LayerEvent,
} from "@taiwanhub/shared";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import type { LayerAvailability } from "@/features/map/query";
import { LayerSection, groupByLayer } from "@/components/map/layer-section";
import { NextEvent, TabelogLink } from "@/components/map/map-results";
import { googleTabelogLink } from "@/lib/tabelog";
import type { LatLng } from "@/lib/places/provider";
import type { ExternalReference } from "@/features/map/external";
import type { ExtraPoint } from "@/components/map/map-canvas";
import { GoogleMapsLink } from "./google-maps-link";
import { LocalNote, isUrl } from "./local-note";
type Row = ExternalReference & { location: LatLng | null };

type Page = {
  references: ExternalReference[];
  nextCursor: string | null;
  totalAuthorizedReferences: number;
};
/** Local summaries and valid cached pins; browsing never mounts provider cards. */
export function ExternalReferences({
  queryKey,
  locatedPlaces,
  area,
  selectedSubjectId,
  t,
  onPoints,
  onSelect,
  events = {},
  locale = "en",
  timeZone = "America/Chicago",
  autoLoad = false,
  onPending,
  reload = 0,
  layers,
}: {
  queryKey: string;
  locatedPlaces: Record<string, LatLng>;
  area: Bounds | undefined;
  selectedSubjectId: string | null;
  t: Copy;
  onPoints: (points: ExtraPoint[]) => void;
  onSelect: (ref: ExternalReference, location: LatLng | null) => void;
  /** Upcoming events attached to these places, by canonical key. */
  events?: Record<string, LayerEvent[]>;
  locale?: Locale;
  timeZone?: string;
  /** Load every local-data page in map MVP. */
  autoLoad?: boolean;
  /** Reports list-only places so a map without their pins still exposes the list. */
  onPending?: (count: number) => void;
  reload?: number;
  /** Applied layers; when given, rows are grouped under one section each. */
  layers?: LayerAvailability[];
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);
  const seq = useRef(0);
  const load = useCallback(
    (cursor: string | null) => {
      const id = ++seq.current;
      const sep = queryKey ? "&" : "?";
      fetch(
        `/api/v1/map/external-references${queryKey}${cursor ? `${sep}cursor=${cursor}` : ""}`,
      )
        .then((r) => {
          if (!r.ok) throw new Error("external-references");
          return r.json();
        })
        .then((json: { data?: Page }) => {
          if (id !== seq.current) return;
          if (!json.data) throw new Error("external-references");
          const page = json.data;
          setRows((current) => [
            ...(cursor ? current : []),
            // Missing coordinates never start a provider request.
            ...page.references.map((ref) => ({
              ...ref,
              location: ref.location ?? null,
            })),
          ]);
          setNext(page.nextCursor);
          setTotal(page.totalAuthorizedReferences);
          setError(false);
        })
        .catch(() => {
          if (id === seq.current) setError(true);
        });
    },
    [queryKey],
  );
  useEffect(() => {
    setRows([]);
    setNext(null);
    load(null);
    // A new query replaces the page; stale responses are ignored by `seq`.
    return () => {
      // This is a request generation, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seq.current++;
    };
  }, [load, reload]);
  const locatedRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        location:
          row.location ??
          (row.providerPlaceId ? locatedPlaces[row.providerPlaceId] : null) ??
          null,
      })),
    [rows, locatedPlaces],
  );
  const settled = locatedRows.filter((r) => r.location).length;
  const pendingRef = useRef(onPending);
  useEffect(() => {
    pendingRef.current = onPending;
  });
  useEffect(() => {
    pendingRef.current?.(rows.length - settled);
  }, [rows.length, settled]);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (autoLoad && next) loadRef.current(next);
  }, [autoLoad, next]);
  const visible = useMemo(
    () =>
      locatedRows.filter(
        (r) =>
          !area ||
          !r.location ||
          withinBounds(r.location.lat, r.location.lng, area),
      ),
    [locatedRows, area],
  );
  const points = useMemo<ExtraPoint[]>(
    () =>
      visible
        .filter((r) => r.location)
        .map((r) => {
          const url = googleTabelogLink(r);
          return {
            key: r.canonicalKey,
            kind: "external" as const,
            lat: r.location!.lat,
            lng: r.location!.lng,
            placeId: r.providerPlaceId ?? undefined,
            label:
              r.name ??
              (isUrl(r.localNote) ? undefined : r.localNote) ??
              undefined,
            tabelog: url && r.name ? { name: r.name, url } : undefined,
            marker: r.types ? googleMarkerKind(r.types) : undefined,
            markerImageUrl: r.markerImageUrl ?? null,
          };
        }),
    [visible],
  );
  const pointsRef = useRef(onPoints);
  const reportedPoints = useRef<string | null>(null);
  useEffect(() => {
    pointsRef.current = onPoints;
  });
  useEffect(() => {
    // Parent camera/layout updates may recreate equivalent bounds. Publishing
    // identical points again would feed another parent render back into this effect.
    const signature = JSON.stringify(points);
    if (signature === reportedPoints.current) return;
    reportedPoints.current = signature;
    pointsRef.current(points);
  }, [points]);
  useEffect(() => () => pointsRef.current([]), []);
  if (!rows.length && !error) return null;
  const renderRow = (row: Row, prefix = "") => (
    <li
      key={prefix + row.subjectId}
      className={`external-row ${row.subjectId === selectedSubjectId ? "selected" : ""}`}
      onClick={(event) => {
        // The whole row opens the place; links and buttons keep their own action.
        if (
          (event.target as HTMLElement).closest(
            "a, button, gmp-place-details-compact",
          )
        )
          return;
        onSelect(row, row.location);
      }}
    >
      <h3>{row.name || t.routeGooglePlace}</h3>
      {!row.location && <span className="chip">{t.awaitingLocation}</span>}
      {row.providerPlaceId && (
        <GoogleMapsLink placeId={row.providerPlaceId} name={row.name} t={t} />
      )}
      {row.isDailyPick && <span className="badge">{t.dailyPick}</span>}
      <NextEvent
        events={events[row.canonicalKey]}
        locale={locale}
        timeZone={timeZone}
      />
      <LocalNote note={row.localNote} t={t} />
      {row.name && (
        <TabelogLink
          name={row.name}
          href={googleTabelogLink(row)}
          t={t}
          className="row-tabelog external-tabelog"
        />
      )}
      <button
        type="button"
        className="text-button"
        aria-current={row.subjectId === selectedSubjectId || undefined}
        onClick={() => onSelect(row, row.location)}
      >
        {t.openPlacePage}
      </button>
    </li>
  );
  const indexed = visible.map((row, index) => ({
    row,
    index,
    layers: row.layers,
  }));
  const { groups, rest } = groupByLayer(indexed, layers);
  const pending = visible.filter((r) => !r.location).length;
  return (
    <section className="external-references" aria-label={t.externalBusinesses}>
      <p className="fine-print" role="status">
        {pending > 0
          ? format(t.externalSummary, { count: visible.length, pending })
          : ""}
      </p>
      {error && (
        <p className="message error-message" role="alert">
          {t.error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => load(rows.length ? next : null)}
          >
            {t.retry}
          </button>
        </p>
      )}
      {layers && groups.length > 0 ? (
        <>
          {groups.map(({ layer, rows }) => (
            <LayerSection
              key={layer.slug}
              layer={layer}
              locale={locale}
              count={rows.length}
            >
              <ul className="result-list">
                {rows.map((r) => renderRow(r.row, `${layer.slug}:`))}
              </ul>
            </LayerSection>
          ))}
          {rest.length > 0 && (
            <ul className="result-list">{rest.map((r) => renderRow(r.row))}</ul>
          )}
        </>
      ) : (
        <ul className="result-list">{visible.map((row) => renderRow(row))}</ul>
      )}
      {next && !autoLoad && (
        <button
          type="button"
          className="button secondary small"
          onClick={() => load(next)}
        >
          {t.loadMoreExternal}
        </button>
      )}
      <span className="sr-only">
        {total > rows.length && format(t.itemsCount, { count: total })}
      </span>
    </section>
  );
}
