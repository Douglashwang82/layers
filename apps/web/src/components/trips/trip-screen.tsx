"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Luggage, Route } from "lucide-react";
import { tripCopy } from "@/lib/trip-copy";
import {
  signInHref,
  tripPanelHref,
  withTripDay,
  withoutTripPanel,
  type TripPanelState,
} from "@/lib/trip-panel";
import {
  layerWorkspaceHref,
  withoutLayerPanel,
  folderPanelHref,
} from "@/lib/layer-workspace";
import { tripGeoJSON, tripPoints, type TripGeoJSON } from "@/lib/trip-map";
import type { TripScreenData } from "@/features/trips/screen";
import type { TripView } from "@/features/trips/repository";
import type { MapCanvasHandle } from "../map/map-canvas";
import type { PanelBack } from "../map/map-sidebar";
import { NewTripForm } from "./new-trip-form";
import { TripPlanner } from "./trip-planner";

/** What the map panel shows for the open trip screen (title, back and body supplied to the shell). */
export type TripScreen = {
  title?: string;
  count?: number;
  back?: PanelBack;
  body: ReactNode;
  /** Said by the panel's live region when the screen changes. */
  announce: string;
  /** Changes when the screen does (not on day focus), so focus can move to the panel. */
  screenKey: string;
  /** The open trip as map data; null when no trip is open. */
  geo: TripGeoJSON | null;
  /** A trip pin was picked on the map. */
  onStop: (stopId: string) => void;
  /** Leaves the trip screens for the map as it was. */
  leave: () => void;
  /** Frames the open trip (the focused day, or all days). */
  fit: () => void;
};

/**
 * The in-map trip screens (list, new trip, one trip). The URL names the
 * screen; the server resolved `data` for it. The open trip's state lives here
 * so the panel list and the map canvas always show the same plan.
 */
export function useTripScreen({
  data,
  panel,
  locale,
  canvas,
  canvasReady,
  mapShown,
}: {
  data: TripScreenData | null;
  /** Null when the URL names no trip screen or trips are disabled. */
  panel: TripPanelState | null;
  locale: string;
  canvas: RefObject<MapCanvasHandle | null>;
  canvasReady: boolean;
  /** The trip is drawn on a map; otherwise the list stands alone. */
  mapShown: boolean;
}): TripScreen | null {
  const t = tripCopy(locale);
  const router = useRouter();
  const search = useSearchParams().toString();
  const [seen, setSeen] = useState(data);
  const [view, setView] = useState<TripView | null>(
    data?.kind === "detail" ? data.view : null,
  );
  // A fresh server answer (navigation, refresh) replaces the local copy.
  if (seen !== data) {
    setSeen(data);
    setView(data?.kind === "detail" ? data.view : null);
  }
  const [picked, setPicked] = useState<{ trip: string; stop: string } | null>(
    null,
  );
  const tripId = view?.trip.id ?? null;
  const selectedStopId = picked && picked.trip === tripId ? picked.stop : null;
  const requested = panel?.panel === "detail" ? panel.day : "all";
  const focus = view?.days.some((d) => d.id === requested) ? requested : "all";

  const go = useCallback(
    (href: string) => router.push(href, { scroll: false }),
    [router],
  );
  const leave = useCallback(() => go(withoutTripPanel(search)), [go, search]);
  const setFocus = (day: string) =>
    window.history.replaceState(
      null,
      "",
      withTripDay(window.location.search, day),
    );

  // Frame the focused day (or the whole trip) when a trip opens, the day
  // changes or the base moves; a base can sit outside the stops' view.
  const fitKey =
    panel?.panel === "detail" && tripId
      ? `${tripId}|${focus}|${view?.base?.itemId ?? ""}`
      : null;
  useEffect(() => {
    if (!fitKey || !canvasReady || !view) return;
    const points = tripPoints(view.days, focus);
    if (!points.length) return;
    const timer = window.setTimeout(
      () => canvas.current?.fitPoints(points),
      120,
    );
    return () => window.clearTimeout(timer);
    // Framing follows the trip and day, not every edit to its stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, canvasReady]);

  // A stop picked in the list is brought into view on the map.
  const selectedLocation = useMemo(
    () =>
      view?.days.flatMap((d) => d.stops).find((s) => s.id === selectedStopId)
        ?.location ?? null,
    [view, selectedStopId],
  );
  useEffect(() => {
    if (canvasReady && selectedLocation)
      canvas.current?.revealPoint(selectedLocation);
  }, [canvas, canvasReady, selectedLocation]);

  const geo = useMemo(
    () =>
      panel?.panel === "detail" && view
        ? tripGeoJSON(view.days, focus, selectedStopId)
        : null,
    [panel?.panel, view, focus, selectedStopId],
  );

  if (!panel) return null;
  const screenKey = `${panel.panel}|${"id" in panel ? panel.id : ""}|${"layer" in panel ? (panel.layer ?? "") : ""}|${"folder" in panel ? (panel.folder ?? "") : ""}`;
  const fit = () => {
    const points = view ? tripPoints(view.days, focus) : [];
    if (points.length) canvas.current?.fitPoints(points);
  };
  const base = { screenKey, geo, leave, fit, onStop: () => {} };
  const listHref = tripPanelHref(search, { panel: "list" });
  const browseHref = layerWorkspaceHref("/layers?tab=mine", search);
  const fresh =
    data &&
    ((panel.panel === "list" && data.kind === "list") ||
      (panel.panel === "new" && data.kind === "new") ||
      (panel.panel === "detail" &&
        data.kind === "detail" &&
        data.id === panel.id));

  if (!data || data.kind === "signin" || !fresh)
    return {
      ...base,
      title: t.trips,
      back: { label: t.closeTrip, onClick: leave },
      announce: t.trips,
      body: (
        <div className="panel-body trip-screen">
          {data?.kind === "signin" ? (
            <div className="empty">
              <Lock size={24} aria-hidden="true" />
              <p>{t.signInToPlan}</p>
              <Link className="button" href={signInHref(search)}>
                {t.signIn}
              </Link>
            </div>
          ) : (
            <p className="muted" role="status">
              {t.creating}
            </p>
          )}
        </div>
      ),
    };

  if (data.kind === "list")
    return {
      ...base,
      title: t.trips,
      count: data.trips.length,
      back: { label: t.closeTrip, onClick: leave },
      announce: `${t.trips}: ${t.stops(data.trips.length)}`,
      body: (
        <div className="panel-body trip-screen">
          {data.trips.length === 0 ? (
            <div className="empty">
              <Route size={24} aria-hidden="true" />
              <p>{t.noTrips}</p>
              <Link
                className="button secondary"
                href={browseHref}
                scroll={false}
              >
                {t.browseLayers}
              </Link>
            </div>
          ) : (
            <ul className="trip-list">
              {data.trips.map((trip) => (
                <li key={trip.id}>
                  <Link
                    href={tripPanelHref(search, {
                      panel: "detail",
                      id: trip.id,
                    })}
                    scroll={false}
                    aria-label={t.openTrip(trip.title)}
                  >
                    <strong>{trip.title}</strong>
                  </Link>
                  <span className="muted">
                    {trip.startsOn === trip.endsOn
                      ? trip.startsOn
                      : `${trip.startsOn} – ${trip.endsOn}`}{" "}
                    · {trip.cityName} · {t.stops(trip.stopCount)} ·{" "}
                    {trip.audience === "group"
                      ? t.groupTrip(trip.ownerName)
                      : t.privateTrip}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    };

  if (data.kind === "new") {
    const source = data.source;
    return {
      ...base,
      title: t.newTrip,
      back: source
        ? {
            label: t.backTo(source.name),
            href:
              source.kind === "layer"
                ? layerWorkspaceHref(
                    `/layers/${encodeURIComponent(source.slug)}`,
                    search,
                  )
                : folderPanelHref(source.slug, search),
          }
        : { label: t.backToTripList, href: listHref },
      announce: t.newTrip,
      body: (
        <div className="panel-body trip-screen">
          {source ? (
            <NewTripForm
              key={source.id}
              locale={locale}
              source={source}
              group={data.group}
              defaultStart={data.defaultStart}
              defaultEnd={data.defaultEnd}
              onCreated={(id) =>
                go(tripPanelHref(search, { panel: "detail", id }))
              }
            />
          ) : (
            <div className="empty">
              <p>{t.noPlaces}</p>
              <Link
                className="button secondary"
                href={browseHref}
                scroll={false}
              >
                {t.browseLayers}
              </Link>
            </div>
          )}
        </div>
      ),
    };
  }

  // One trip.
  if (!view)
    return {
      ...base,
      title: t.trips,
      back: { label: t.backToTripList, href: listHref },
      announce: t.tripUnavailable,
      body: (
        <div className="panel-body trip-screen">
          <div className="empty">
            <Lock size={24} aria-hidden="true" />
            <p>{t.tripUnavailable}</p>
          </div>
        </div>
      ),
    };
  const total = view.days.reduce((n, d) => n + d.stops.length, 0);
  return {
    ...base,
    title: view.trip.title,
    count: total,
    back: { label: t.backToTripList, href: listHref },
    announce: `${view.trip.title}: ${t.stops(total)}`,
    onStop: (stopId) => setPicked({ trip: view.trip.id, stop: stopId }),
    body: (
      <div className="panel-body trip-screen">
        <button type="button" className="text-button" onClick={leave}>
          {t.closeTrip}
        </button>
        <TripPlanner
          key={view.trip.id}
          view={view}
          onView={setView}
          locale={locale}
          focus={focus}
          onFocus={setFocus}
          selectedStopId={selectedStopId}
          onSelectStop={(stop) =>
            setPicked(stop ? { trip: view.trip.id, stop } : null)
          }
          mapShown={mapShown}
          onDeleted={() => go(listHref)}
        />
      </div>
    ),
  };
}

/** The map header's way into the member's trips; it stays on the map. */
export function TripsEntry({
  locale,
  active,
}: {
  locale: string;
  active: boolean;
}) {
  const search = useSearchParams().toString();
  return (
    <Link
      className="map-float-button"
      scroll={false}
      aria-current={active ? "page" : undefined}
      href={tripPanelHref(withoutLayerPanel(search).split("?")[1] ?? "", {
        panel: "list",
      })}
    >
      <Luggage size={20} aria-hidden="true" />
      <span>{tripCopy(locale).trips}</span>
    </Link>
  );
}

/** "Plan a trip" from a layer or folder: opens the new-trip flow in the panel with that source chosen. */
export function TripPlanLink({
  layer,
  folder,
  className = "button secondary",
  children,
}: {
  layer?: string;
  folder?: string;
  className?: string;
  children: ReactNode;
}) {
  const search = useSearchParams().toString();
  return (
    <Link
      className={className}
      scroll={false}
      href={tripPanelHref(withoutLayerPanel(search).split("?")[1] ?? "", {
        panel: "new",
        layer,
        folder,
      })}
    >
      {children}
    </Link>
  );
}
