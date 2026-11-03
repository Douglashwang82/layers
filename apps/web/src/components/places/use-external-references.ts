"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { googleMarkerKind, withinBounds, type Bounds } from "@taiwanhub/shared";
import type { ExtraPoint } from "@/components/map/map-canvas";
import type { ExternalReference } from "@/features/map/external";
import type { LatLng } from "@/lib/places/provider";
import { googleTabelogLink } from "@/lib/tabelog";
import { isUrl } from "./local-note";

export type ExternalRowData = ExternalReference & { location: LatLng | null };

type Page = {
  references: ExternalReference[];
  nextCursor: string | null;
};

/**
 * Google places on the applied layers: every local-data page for the query,
 * located from the local cache. The pins come from this data whichever screen
 * the panel shows, and browsing never starts a provider request.
 */
export function useExternalReferences({
  queryKey,
  locatedPlaces,
  area,
  reload,
}: {
  queryKey: string;
  locatedPlaces: Record<string, LatLng>;
  area: Bounds | undefined;
  reload: number;
}) {
  const [loaded, setLoaded] = useState<ExternalRowData[]>([]);
  const [next, setNext] = useState<string | null>(null);
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
          setLoaded((current) => [
            ...(cursor ? current : []),
            // Missing coordinates never start a provider request.
            ...page.references.map((ref) => ({
              ...ref,
              location: ref.location ?? null,
            })),
          ]);
          setNext(page.nextCursor);
          setError(false);
        })
        .catch(() => {
          if (id === seq.current) setError(true);
        });
    },
    [queryKey],
  );
  useEffect(() => {
    setLoaded([]);
    setNext(null);
    load(null);
    // A new query replaces the page; stale responses are ignored by `seq`.
    return () => {
      // This is a request generation, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seq.current++;
    };
  }, [load, reload]);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (next) loadRef.current(next);
  }, [next]);
  const located = useMemo(
    () =>
      loaded.map((row) => ({
        ...row,
        location:
          row.location ??
          (row.providerPlaceId ? locatedPlaces[row.providerPlaceId] : null) ??
          null,
      })),
    [loaded, locatedPlaces],
  );
  const rows = useMemo(
    () =>
      located.filter(
        (r) =>
          !area ||
          !r.location ||
          withinBounds(r.location.lat, r.location.lng, area),
      ),
    [located, area],
  );
  // Camera and layout updates can recreate equivalent bounds. The signature
  // keeps equal points the same array, so framing does not run again for them.
  const signature = JSON.stringify(rows.flatMap(rowPoint));
  const points = useMemo(
    () => JSON.parse(signature) as ExtraPoint[],
    [signature],
  );
  return {
    /** The places in the current area, including those still without a pin. */
    rows,
    points,
    /** Every loaded place with no location, inside the area or not. */
    unlocated: located.filter((r) => !r.location).length,
    /** The shown places with no location. */
    pending: rows.filter((r) => !r.location).length,
    error,
    retry: () => load(loaded.length ? next : null),
  };
}

function rowPoint(row: ExternalRowData): ExtraPoint[] {
  if (!row.location) return [];
  const url = googleTabelogLink(row);
  return [
    {
      key: row.canonicalKey,
      kind: "external",
      lat: row.location.lat,
      lng: row.location.lng,
      placeId: row.providerPlaceId ?? undefined,
      label:
        row.name ??
        (isUrl(row.localNote) ? undefined : row.localNote) ??
        undefined,
      tabelog: url && row.name ? { name: row.name, url } : undefined,
      marker: row.types ? googleMarkerKind(row.types) : undefined,
      markerImageUrl: row.markerImageUrl ?? null,
    },
  ];
}
