"use client";
import { useEffect, useRef, useState } from "react";
import type { TripDayView } from "@/features/trips/repository";
import "mapbox-gl/dist/mapbox-gl.css";

/** Day colors; days 8–14 reuse them with a dotted line. Color is never the only cue. */
export const dayColors = [
  "#006A51",
  "#3B4FC4",
  "#A3480F",
  "#7A3E9D",
  "#805600",
  "#0E6E8C",
  "#14261F",
];
export const dayColor = (index: number) => dayColors[index % dayColors.length];

type MapboxMap = import("mapbox-gl").Map;
type MapboxMarker = import("mapbox-gl").Marker;

/**
 * Trip stops on a Mapbox map: numbered pins and dashed straight segments per
 * day. Without a token, or when the renderer fails, it renders nothing and
 * reports `onUnavailable`; the list carries the same content.
 */
export function TripMap({
  days,
  focus,
  label,
  token,
  onUnavailable,
}: {
  days: TripDayView[];
  /** A day id, or "all". */
  focus: string;
  label: string;
  /** Mapbox token from the server page (runtime env, as the main map does). */
  token: string | undefined;
  onUnavailable: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markers = useRef<MapboxMarker[]>([]);
  const lib = useRef<typeof import("mapbox-gl").default | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) {
      onUnavailable();
      return;
    }
    let stopped = false;
    import("mapbox-gl")
      .then(({ default: mapboxgl }) => {
        if (stopped || !ref.current) return;
        lib.current = mapboxgl;
        const map = new mapboxgl.Map({
          container: ref.current,
          accessToken: token,
          style: "mapbox://styles/mapbox/light-v11",
          center: [-95.37, 29.76],
          zoom: 10,
        });
        map.addControl(new mapboxgl.NavigationControl());
        let loaded = false;
        // Transient tile errors after load are not fatal; only initialization failures are.
        map.on("error", () => {
          if (!loaded) onUnavailable();
        });
        map.on("load", () => {
          loaded = true;
          mapRef.current = map;
          setReady(true);
        });
      })
      .catch(() => onUnavailable());
    return () => {
      stopped = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = lib.current;
    if (!ready || !map || !mapboxgl) return;
    for (const m of markers.current) m.remove();
    markers.current = [];
    const style = map.getStyle();
    for (const layer of style?.layers ?? [])
      if (layer.id.startsWith("trip-day-")) map.removeLayer(layer.id);
    for (const id of Object.keys(style?.sources ?? {}))
      if (id.startsWith("trip-day-")) map.removeSource(id);
    const bounds = new mapboxgl.LngLatBounds();
    days.forEach((day, index) => {
      if (focus !== "all" && focus !== day.id) return;
      const located = day.stops.filter((s) => s.location);
      if (!located.length) return;
      const color = dayColor(index);
      const coordinates = located.map(
        (s) => [s.location!.lng, s.location!.lat] as [number, number],
      );
      const id = `trip-day-${day.id}`;
      map.addSource(id, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates },
        },
      });
      map.addLayer({
        id,
        type: "line",
        source: id,
        paint: {
          "line-color": color,
          "line-width": 3,
          "line-dasharray": index >= dayColors.length ? [0.5, 1.5] : [2, 1.5],
        },
      });
      located.forEach((stop, i) => {
        const el = document.createElement("div");
        el.className = "trip-pin";
        el.style.background = color;
        el.textContent =
          focus === "all" ? `${index + 1}·${i + 1}` : String(i + 1);
        el.setAttribute("aria-hidden", "true");
        markers.current.push(
          new mapboxgl.Marker({ element: el })
            .setLngLat([stop.location!.lng, stop.location!.lat])
            .addTo(map),
        );
        bounds.extend([stop.location!.lng, stop.location!.lat]);
      });
    });
    if (!bounds.isEmpty())
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
  }, [ready, days, focus]);

  if (!token) return null;
  return (
    <div
      ref={ref}
      className="trip-map"
      role="img"
      aria-label={label}
      data-testid="trip-map"
    />
  );
}
