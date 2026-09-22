"use client";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import type { Map as MapboxMap, GeoJSONSource } from "mapbox-gl";
import type { Bounds, ItemType } from "@taiwanhub/shared";
import type { MapItem } from "@/features/map/query";
import type { Copy, Locale } from "@/lib/dictionary";
import "mapbox-gl/dist/mapbox-gl.css";
export type MapCanvasHandle = {
  fitTo: (items: MapItem[]) => void;
  fitBounds: (bounds: Bounds) => void;
  flyTo: (center: [number, number], zoom?: number) => void;
  resize: () => void;
  retry: () => void;
};
export type CanvasStatus = "loading" | "ready" | "failed";
/** Resolve a theme token at runtime so pins follow the stylesheet, not a literal. */
function themeColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}
/** Marker glyphs (icon + color identify item type; layers never recolor an item). */
const glyphs: Record<ItemType, string> = {
  place:
    '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  event:
    '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  content:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
};
function glyphImage(type: ItemType, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${glyphs[type]}</svg>`;
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(32, 32);
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}
function toGeoJSON(items: MapItem[]) {
  return {
    type: "FeatureCollection" as const,
    features: items
      .filter((i) => i.latitude != null && i.longitude != null)
      .map((i) => ({
        type: "Feature" as const,
        properties: { key: i.key, type: i.type },
        geometry: {
          type: "Point" as const,
          coordinates: [i.longitude!, i.latitude!],
        },
      })),
  };
}
export function MapCanvas({
  ref,
  token,
  items,
  selectedKey,
  center,
  zoom,
  locale,
  t,
  padding,
  onSelect,
  onUserMove,
  onStatus,
  onLocationDenied,
}: {
  ref?: Ref<MapCanvasHandle>;
  token: string | undefined;
  items: MapItem[];
  selectedKey: string | null;
  center: [number, number];
  zoom: number;
  locale: Locale;
  t: Copy;
  padding: { top: number; right: number; bottom: number; left: number };
  onSelect: (key: string | null) => void;
  onUserMove: (bounds: Bounds) => void;
  onStatus: (status: CanvasStatus) => void;
  onLocationDenied?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const loadedRef = useRef(false);
  const userMovedRef = useRef(false);
  const latest = useRef({
    items,
    selectedKey,
    onSelect,
    onUserMove,
    onStatus,
    onLocationDenied,
    padding,
  });
  useEffect(() => {
    latest.current = {
      items,
      selectedKey,
      onSelect,
      onUserMove,
      onStatus,
      onLocationDenied,
      padding,
    };
  });
  const [attempt, setAttempt] = useState(0);
  useImperativeHandle(ref, () => ({
    fitTo(list) {
      const map = mapRef.current;
      const points = list.filter(
        (i) => i.latitude != null && i.longitude != null,
      );
      if (!map || !points.length) return;
      if (points.length === 1) {
        map.easeTo({
          center: [points[0].longitude!, points[0].latitude!],
          zoom: Math.max(map.getZoom(), 14),
          duration: 240,
        });
        return;
      }
      let w = Infinity,
        s = Infinity,
        e = -Infinity,
        n = -Infinity;
      for (const p of points) {
        w = Math.min(w, p.longitude!);
        e = Math.max(e, p.longitude!);
        s = Math.min(s, p.latitude!);
        n = Math.max(n, p.latitude!);
      }
      map.fitBounds([w, s, e, n], { padding: 56, maxZoom: 15, duration: 240 });
    },
    fitBounds(bounds) {
      mapRef.current?.fitBounds(bounds, { padding: 24, duration: 0 });
    },
    flyTo(target, targetZoom) {
      mapRef.current?.easeTo({
        center: target,
        zoom: targetZoom ?? mapRef.current.getZoom(),
        duration: 240,
      });
    },
    resize() {
      mapRef.current?.resize();
    },
    retry() {
      setAttempt((n) => n + 1);
    },
  }));
  // Initialization and cleanup are separate from data, selection and locale updates.
  useEffect(() => {
    if (!token || !container.current) return;
    let stopped = false;
    let dispose = () => {};
    loadedRef.current = false;
    latest.current.onStatus("loading");
    import("mapbox-gl")
      .then(async ({ default: mapboxgl }) => {
        if (stopped || !container.current) return;
        const map = new mapboxgl.Map({
          container: container.current,
          accessToken: token,
          style: "mapbox://styles/mapbox/light-v11",
          center,
          zoom,
          attributionControl: true,
          cooperativeGestures: false,
        });
        mapRef.current = map;
        dispose = () => {
          mapRef.current = null;
          map.remove();
        };
        map.addControl(
          new mapboxgl.NavigationControl({ showCompass: false }),
          "bottom-right",
        );
        const geolocate = new mapboxgl.GeolocateControl({
          positionOptions: { enableHighAccuracy: false },
          trackUserLocation: false,
          showUserLocation: true,
        });
        map.addControl(geolocate, "bottom-right");
        geolocate.on("error", () => latest.current.onLocationDenied?.());
        const fail = () => {
          if (!loadedRef.current) {
            latest.current.onStatus("failed");
            stopped = true;
            dispose();
          }
        };
        // Transient tile errors after load are not fatal; only initialization failures are.
        map.on("error", (event) => {
          if (!loadedRef.current) fail();
          else if (process.env.NODE_ENV !== "production")
            console.warn("Map tile error", event.error?.message);
        });
        const timeout = window.setTimeout(fail, 20000);
        map.on("load", async () => {
          window.clearTimeout(timeout);
          if (stopped) return;
          const text = themeColor("--th-text", "#14261f");
          const colors: Record<ItemType, string> = {
            place: themeColor("--th-map-place", "#27d8a1"),
            event: themeColor("--th-map-event", "#ff846b"),
            content: themeColor("--th-map-content", "#ffd76a"),
          };
          const lime = themeColor("--th-primary", "#c7f464");
          try {
            for (const type of ["place", "event", "content"] as const)
              map.addImage(`th-${type}`, await glyphImage(type, text), {
                pixelRatio: 2,
              });
          } catch {
            /* glyphs are decorative; circles and colors still identify type */
          }
          if (stopped) return;
          map.addSource("items", {
            type: "geojson",
            data: toGeoJSON(latest.current.items),
            cluster: true,
            clusterRadius: 48,
            clusterMaxZoom: 16,
            promoteId: "key",
          });
          map.addLayer({
            id: "clusters",
            type: "circle",
            source: "items",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#ffffff",
              "circle-stroke-color": text,
              "circle-stroke-width": 2,
              "circle-radius": [
                "step",
                ["get", "point_count"],
                18,
                10,
                22,
                50,
                28,
              ],
            },
          });
          map.addLayer({
            id: "cluster-count",
            type: "symbol",
            source: "items",
            filter: ["has", "point_count"],
            layout: {
              "text-field": ["get", "point_count_abbreviated"],
              "text-size": 14,
              "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
            },
            paint: { "text-color": text },
          });
          map.addLayer({
            id: "selected-halo",
            type: "circle",
            source: "items",
            filter: ["==", ["get", "key"], latest.current.selectedKey ?? ""],
            paint: {
              "circle-radius": 22,
              "circle-color": lime,
              "circle-opacity": 0.9,
              "circle-stroke-color": text,
              "circle-stroke-width": 2,
            },
          });
          map.addLayer({
            id: "points",
            type: "circle",
            source: "items",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-radius": 13,
              "circle-color": [
                "match",
                ["get", "type"],
                "place",
                colors.place,
                "event",
                colors.event,
                colors.content,
              ],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 3,
            },
          });
          map.addLayer({
            id: "points-outline",
            type: "circle",
            source: "items",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-radius": 13,
              "circle-color": "rgba(0,0,0,0)",
              "circle-stroke-color": text,
              "circle-stroke-width": 1,
            },
          });
          map.addLayer({
            id: "points-icon",
            type: "symbol",
            source: "items",
            filter: ["!", ["has", "point_count"]],
            layout: {
              "icon-image": ["concat", "th-", ["get", "type"]],
              "icon-size": 0.45,
              "icon-allow-overlap": true,
            },
          });
          type Feature = {
            properties?: Record<string, unknown> | null;
            geometry: { type: string; coordinates: unknown };
          };
          map.on("click", "points", (e) => {
            const feature = e.features?.[0] as Feature | undefined;
            const key = feature?.properties?.key;
            if (key) latest.current.onSelect(String(key));
          });
          map.on("click", "clusters", (e) => {
            const feature = e.features?.[0] as Feature | undefined;
            const clusterId = feature?.properties?.cluster_id;
            const source = map.getSource("items") as GeoJSONSource | undefined;
            if (
              clusterId == null ||
              !source ||
              feature?.geometry.type !== "Point"
            )
              return;
            source.getClusterExpansionZoom(
              Number(clusterId),
              (err, expansion) => {
                if (err || expansion == null) return;
                map.easeTo({
                  center: feature.geometry.coordinates as [number, number],
                  zoom: expansion,
                  duration: 240,
                });
              },
            );
          });
          for (const layer of ["points", "clusters"]) {
            map.on(
              "mouseenter",
              layer,
              () => (map.getCanvas().style.cursor = "pointer"),
            );
            map.on(
              "mouseleave",
              layer,
              () => (map.getCanvas().style.cursor = ""),
            );
          }
          const markUser = (e: unknown) => {
            if ((e as { originalEvent?: unknown }).originalEvent)
              userMovedRef.current = true;
          };
          map.on("dragstart", markUser);
          map.on("zoomstart", markUser);
          map.on("wheel", () => (userMovedRef.current = true));
          map.on("moveend", () => {
            if (!userMovedRef.current) return;
            userMovedRef.current = false;
            const b = map.getBounds();
            if (b)
              latest.current.onUserMove([
                b.getWest(),
                b.getSouth(),
                b.getEast(),
                b.getNorth(),
              ]);
          });
          map.setPadding(latest.current.padding);
          loadedRef.current = true;
          latest.current.onStatus("ready");
        });
      })
      .catch(() => latest.current.onStatus("failed"));
    return () => {
      stopped = true;
      loadedRef.current = false;
      dispose();
    };
    // center/zoom only seed the initial camera; later changes go through the handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, attempt]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("items") as GeoJSONSource | undefined)?.setData(
      toGeoJSON(items),
    );
  }, [items]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setFilter("selected-halo", ["==", ["get", "key"], selectedKey ?? ""]);
  }, [selectedKey]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setPadding(padding);
  }, [padding]);
  // Base map labels follow the interface language; item titles are localized in the panel.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const field = locale === "zh-TW" ? "name_zh-Hant" : "name_en";
    for (const layer of map.getStyle()?.layers ?? []) {
      if (
        layer.type !== "symbol" ||
        !layer.layout ||
        !("text-field" in layer.layout)
      )
        continue;
      if (layer.id.startsWith("cluster") || layer.id.startsWith("points"))
        continue;
      map.setLayoutProperty(layer.id, "text-field", [
        "coalesce",
        ["get", field],
        ["get", "name"],
      ]);
    }
  }, [locale]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={container}
      className="map-canvas"
      role="region"
      aria-label={t.map}
      data-attempt={attempt}
    />
  );
}
