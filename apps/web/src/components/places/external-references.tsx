"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { withinBounds, type Bounds } from "@taiwanhub/shared";
import { type Copy, format } from "@/lib/dictionary";
import type { LatLng, PlacesProvider } from "@/lib/places/provider";
import type { ExternalReference } from "@/features/map/external";
import type { ExtraPoint } from "@/components/map/map-canvas";
import { ProviderDetails } from "./provider-slot";
type Row = ExternalReference & {
  state: "loading" | "resolved" | "unavailable";
  location: LatLng | null;
};
type Page = {
  references: ExternalReference[];
  nextCursor: string | null;
  totalAuthorizedReferences: number;
};
/** At most three provider detail loads run at once. */
const concurrency = 3;
/**
 * Authorized external places for the applied layers. The server knows only
 * provider IDs, so rows resolve their location through visible provider
 * components, a bounded page at a time. Rows and pins share one view model:
 * an out-of-area point leaves both, and an unresolved row is listed as
 * awaiting location, never pinned at a made-up coordinate.
 */
export function ExternalReferences({
  provider,
  queryKey,
  area,
  selectedSubjectId,
  t,
  onPoints,
  onSelect,
}: {
  provider: PlacesProvider | null;
  queryKey: string;
  area: Bounds | undefined;
  selectedSubjectId: string | null;
  t: Copy;
  onPoints: (points: ExtraPoint[]) => void;
  onSelect: (ref: ExternalReference, location: LatLng | null) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);
  const seq = useRef(0);
  const load = (cursor: string | null) => {
    const id = ++seq.current;
    const sep = queryKey ? "&" : "?";
    fetch(
      `/api/v1/map/external-references${queryKey}${cursor ? `${sep}cursor=${cursor}` : ""}`,
    )
      .then((r) => r.json())
      .then((json: { data?: Page }) => {
        if (id !== seq.current || !json.data) return;
        const page = json.data;
        setRows((current) => [
          ...(cursor ? current : []),
          ...page.references.map((ref) => ({
            ...ref,
            state: (provider && ref.providerPlaceId
              ? "loading"
              : "unavailable") as Row["state"],
            location: null,
          })),
        ]);
        setNext(page.nextCursor);
        setTotal(page.totalAuthorizedReferences);
        setError(false);
      })
      .catch(() => {
        if (id === seq.current) setError(true);
      });
  };
  useEffect(() => {
    load(null);
    // A new query replaces the page; stale responses are ignored by `seq`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, provider]);
  const settled = rows.filter((r) => r.state !== "loading").length;
  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          !area ||
          !r.location ||
          withinBounds(r.location.lat, r.location.lng, area),
      ),
    [rows, area],
  );
  const points = useMemo<ExtraPoint[]>(
    () =>
      visible
        .filter((r) => r.state === "resolved" && r.location)
        .map((r) => ({
          key: r.canonicalKey,
          kind: "external" as const,
          lat: r.location!.lat,
          lng: r.location!.lng,
        })),
    [visible],
  );
  const pointsRef = useRef(onPoints);
  useEffect(() => {
    pointsRef.current = onPoints;
  });
  useEffect(() => {
    pointsRef.current(points);
  }, [points]);
  useEffect(() => () => pointsRef.current([]), []);
  const update = (subjectId: string, patch: Partial<Row>) =>
    setRows((list) =>
      list.map((r) => (r.subjectId === subjectId ? { ...r, ...patch } : r)),
    );
  if (!rows.length && !error) return null;
  const pending = visible.filter((r) => r.state !== "resolved").length;
  return (
    <section className="external-references" aria-label={t.externalBusinesses}>
      <h3>{t.externalBusinesses}</h3>
      <p className="fine-print" role="status">
        {format(t.externalSummary, { count: visible.length, pending })}
      </p>
      {error && (
        <p className="message error-message" role="alert">
          {t.error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => load(null)}
          >
            {t.retry}
          </button>
        </p>
      )}
      <ul className="result-list">
        {visible.map((row, index) => (
          <li
            key={row.subjectId}
            className={row.subjectId === selectedSubjectId ? "selected" : ""}
          >
            {provider &&
              row.providerPlaceId &&
              row.state !== "unavailable" &&
              index < settled + concurrency && (
                <ProviderDetails
                  provider={provider}
                  placeId={row.providerPlaceId}
                  compact
                  onLoad={(place) =>
                    update(row.subjectId, {
                      state: place.location ? "resolved" : "unavailable",
                      location: place.location,
                    })
                  }
                  onError={() =>
                    update(row.subjectId, { state: "unavailable" })
                  }
                />
              )}
            {row.state === "unavailable" && (
              <p className="fine-print">{t.externalUnavailable}</p>
            )}
            {row.state !== "resolved" && (
              <span className="chip">{t.awaitingLocation}</span>
            )}
            {row.localNote && <p className="muted">{row.localNote}</p>}
            <button
              type="button"
              className="text-button"
              aria-current={row.subjectId === selectedSubjectId || undefined}
              onClick={() => onSelect(row, row.location)}
            >
              {t.openPlacePage}
            </button>
          </li>
        ))}
      </ul>
      {next && (
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
