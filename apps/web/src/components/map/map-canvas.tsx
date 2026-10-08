"use client";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import type { Map as MapboxMap, GeoJSONSource } from "mapbox-gl";
import { maxMapPoints, type Bounds, type ItemType } from "@taiwanhub/shared";
import type { MapItem } from "@/features/map/query";
import type { Copy, Locale } from "@/lib/dictionary";
import "mapbox-gl/dist/mapbox-gl.css";
import { SelectedPet } from "./selected-pet";
import { selectedPetTarget } from "@/lib/marker-pet";
import {
  applyJadeAtlas,
  flatMapOptions,
  jadePalette,
} from "@/lib/map-appearance";
import { loadMarkerArtwork } from "@/lib/map-marker-art";
export type MapCanvasHandle = {
  fitTo: (items: MapItem[]) => void;
  /** Current camera center, used to bias provider search toward what the user sees. */
  getCenter: () => { lat: number; lng: number } | null;
  /** Frame provider search results, which often fall outside the current view. */
  fitPoints: (points: { lat: number; lng: number }[]) => void;
  /** Center a provider-resolved point, respecting reduced motion and panel padding. */
  focusPoint: (point: { lat: number; lng: number }) => void;
  fitBounds: (bounds: Bounds) => void;
  flyTo: (center: [number, number], zoom?: number) => void;
  resize: () => void;
  retry: () => void;
};
export type CanvasStatus = "loading" | "ready" | "failed";
/**
 * Provider-resolved points (temporary search results and authorized external
 * references). Kept in their own source so clearing a search never touches
 * catalog or layer pins, and never persisted.
 */
export type ExtraPoint = {
  key: string;
  kind: "search" | "external";
  lat: number;
  lng: number;
  /** Provider ID for reopening the selection; never rendered or stored. */
  placeId?: string;
};
function extraGeoJSON(points: ExtraPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((p) => ({
      type: "Feature" as const,
      properties: { key: p.key, kind: p.kind },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    })),
  };
}
function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
/** Resolve a theme token at runtime so pins follow the stylesheet, not a literal. */
function themeColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
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
const noPoints: ExtraPoint[] = [];
export function MapCanvas({
  ref,
  token,
  items,
  selectedKey,
  extraPoints = noPoints,
  extraSelectedKey = null,
  effects = false,
  center,
  zoom,
  locale,
  t,
  padding,
  onSelect,
  onSelectExtra,
  onUserMove,
  onStatus,
  onLocationDenied,
}: {
  ref?: Ref<MapCanvasHandle>;
  token: string | undefined;
  items: MapItem[];
  selectedKey: string | null;
  extraPoints?: ExtraPoint[];
  extraSelectedKey?: string | null;
  /** Presentation-only selection effects (FEATURE_MAP_EFFECTS). */
  effects?: boolean;
  onSelectExtra?: (key: string) => void;
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
  const [readyMap, setReadyMap] = useState<MapboxMap | null>(null);
  const loadedRef = useRef(false);
  const userMovedRef = useRef(false);
  // The canvas keeps its point budget: extra points reserve room within it.
  const catalogItems = useMemo(
    () => items.slice(0, Math.max(0, maxMapPoints - extraPoints.length)),
    [items, extraPoints.length],
  );
  const latest = useRef({
    items: catalogItems,
    extraPoints,
    extraSelectedKey,
    effects,
    onSelectExtra,
    selectedKey,
    onSelect,
    onUserMove,
    onStatus,
    onLocationDenied,
    padding,
  });
  useEffect(() => {
    latest.current = {
      items: catalogItems,
      extraPoints,
      extraSelectedKey,
      effects,
      onSelectExtra,
      selectedKey,
      onSelect,
      onUserMove,
      onStatus,
      onLocationDenied,
      padding,
    };
  });
  const [attempt, setAttempt] = useState(0);
  /**
   * With effects on, a selection dims other pins (still legible, never hidden)
   * and changes ease in. Reduced motion keeps the dimming but not the easing.
   */
  function applyEffects(map: MapboxMap) {
    const { effects: on, selectedKey: a, extraSelectedKey: b } = latest.current;
    const opacity = on && (a || b) ? 0.55 : 1;
    const duration = on && !prefersReducedMotion() ? 200 : 0;
    for (const layer of ["points", "extra-points"]) {
      if (!map.getLayer(layer)) continue;
      map.setPaintProperty(layer, "circle-opacity-transition", {
        duration,
        delay: 0,
      });
      map.setPaintProperty(layer, "circle-opacity", opacity);
    }
    if (map.getLayer("points-icon")) {
      map.setLayoutProperty("points-icon", "icon-size", [
        "case",
        ["==", ["get", "key"], a ?? ""],
        0.8,
        0.6,
      ]);
      map.setPaintProperty("points-icon", "icon-opacity-transition", {
        duration,
        delay: 0,
      });
      map.setPaintProperty("points-icon", "icon-opacity", [
        "case",
        ["==", ["get", "key"], a ?? ""],
        1,
        opacity,
      ]);
    }
  }
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
          duration: prefersReducedMotion() ? 0 : 240,
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
      map.fitBounds([w, s, e, n], {
        padding: 56,
        maxZoom: 15,
        duration: prefersReducedMotion() ? 0 : 240,
      });
    },
    getCenter() {
      const c = mapRef.current?.getCenter();
      return c ? { lat: c.lat, lng: c.lng } : null;
    },
    fitPoints(points) {
      const map = mapRef.current;
      if (!map || !points.length) return;
      let w = Infinity,
        s = Infinity,
        e = -Infinity,
        n = -Infinity;
      for (const p of points) {
        w = Math.min(w, p.lng);
        e = Math.max(e, p.lng);
        s = Math.min(s, p.lat);
        n = Math.max(n, p.lat);
      }
      map.fitBounds([w, s, e, n], {
        padding: 56,
        maxZoom: 15,
        duration: prefersReducedMotion() || !latest.current.effects ? 0 : 400,
      });
    },
    focusPoint(point) {
      const map = mapRef.current;
      if (!map) return;
      const options = {
        center: [point.lng, point.lat] as [number, number],
        zoom: Math.max(map.getZoom(), 14),
      };
      if (prefersReducedMotion() || !latest.current.effects)
        map.jumpTo(options);
      else map.easeTo({ ...options, duration: 400 });
    },
    fitBounds(bounds) {
      mapRef.current?.fitBounds(bounds, { padding: 24, duration: 0 });
    },
    flyTo(target, targetZoom) {
      mapRef.current?.easeTo({
        center: target,
        zoom: targetZoom ?? mapRef.current.getZoom(),
        duration: prefersReducedMotion() ? 0 : 240,
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
          ...flatMapOptions,
          container: container.current,
          accessToken: token,
          style: "mapbox://styles/mapbox/light-v11",
          center,
          zoom,
          attributionControl: true,
          cooperativeGestures: false,
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        mapRef.current = map;
        dispose = () => {
          setReadyMap(null);
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
          applyJadeAtlas(map, locale);
          const text = jadePalette.ink;
          const colors: Record<ItemType, string> = {
            place: jadePalette.place,
            event: jadePalette.event,
            content: jadePalette.content,
          };
          const lime = themeColor("--th-primary", "#c7f464");
          // One atlas image per type, not one WebGL renderer per point.
          const artwork = await Promise.allSettled(
            (["place", "event", "content"] as const).map(async (type) => ({
              type,
              image: await loadMarkerArtwork(type),
            })),
          );
          if (stopped) return;
          for (const result of artwork)
            if (result.status === "fulfilled")
              map.addImage(`th-${result.value.type}`, result.value.image, {
                pixelRatio: 2,
              });
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
              "circle-stroke-color": jadePalette.roadEdge,
              "circle-stroke-width": 1.5,
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
              "circle-radius": 12,
              "circle-color": lime,
              "circle-opacity": 0.9,
              "circle-stroke-color": text,
              "circle-stroke-width": 1.5,
            },
          });
          map.addLayer({
            id: "points",
            type: "circle",
            source: "items",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-radius": 5,
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
              "circle-stroke-width": 2,
            },
          });
          map.addLayer({
            id: "points-hit",
            type: "circle",
            source: "items",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-radius": 22,
              "circle-opacity": 0,
            },
          });
          map.addLayer({
            id: "points-icon",
            type: "symbol",
            source: "items",
            minzoom: 12,
            filter: ["!", ["has", "point_count"]],
            layout: {
              "icon-image": [
                "coalesce",
                ["image", ["concat", "th-", ["get", "type"]]],
                "",
              ],
              "icon-size": 0.6,
              "icon-anchor": "bottom",
              "icon-offset": [0, 8],
              "icon-pitch-alignment": "viewport",
              "icon-rotation-alignment": "viewport",
              "icon-allow-overlap": false,
              "icon-padding": 5,
            },
          });
          type Feature = {
            properties?: Record<string, unknown> | null;
            geometry: { type: string; coordinates: unknown };
          };
          map.addSource("places-extra", {
            type: "geojson",
            data: extraGeoJSON(latest.current.extraPoints),
          });
          map.addLayer({
            id: "extra-halo",
            type: "circle",
            source: "places-extra",
            filter: [
              "==",
              ["get", "key"],
              latest.current.extraSelectedKey ?? "",
            ],
            paint: {
              "circle-radius": 22,
              "circle-color": lime,
              "circle-opacity": 0.9,
              "circle-stroke-color": text,
              "circle-stroke-width": 2,
            },
          });
          map.addLayer({
            id: "extra-points",
            type: "circle",
            source: "places-extra",
            paint: {
              "circle-radius": 11,
              // Search results are hollow; saved/layer external places are filled.
              "circle-color": [
                "match",
                ["get", "kind"],
                "search",
                "#ffffff",
                colors.place,
              ],
              "circle-stroke-color": text,
              "circle-stroke-width": 2.5,
            },
          });
          map.on("click", "extra-points", (e) => {
            const key = (e.features?.[0] as Feature | undefined)?.properties
              ?.key;
            if (key) latest.current.onSelectExtra?.(String(key));
          });
          applyEffects(map);
          map.on("click", ["points-hit", "points-icon"], (e) => {
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
                  duration: prefersReducedMotion() ? 0 : 240,
                });
              },
            );
          });
          for (const layer of [
            "points-hit",
            "points-icon",
            "clusters",
            "extra-points",
          ]) {
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
          setReadyMap(map);
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
      toGeoJSON(catalogItems),
    );
  }, [catalogItems]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("places-extra") as GeoJSONSource | undefined)?.setData(
      extraGeoJSON(extraPoints),
    );
  }, [extraPoints]);
  // Selection is a filter/paint update on the stable map; it never remounts or refetches.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setFilter("selected-halo", ["==", ["get", "key"], selectedKey ?? ""]);
    map.setFilter("extra-halo", ["==", ["get", "key"], extraSelectedKey ?? ""]);
    applyEffects(map);
  }, [selectedKey, extraSelectedKey, effects]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setPadding(padding);
  }, [padding]);
  // Base map labels follow the interface language; item titles are localized in the panel.
  useEffect(() => {
    if (readyMap) applyJadeAtlas(readyMap, locale);
  }, [locale, readyMap]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const petTarget = selectedPetTarget(
    catalogItems,
    extraPoints,
    selectedKey,
    extraSelectedKey,
  );
  const petItem = catalogItems.find((item) => item.key === petTarget?.key);
  const petName = petItem
    ? locale === "zh-TW"
      ? petItem.nameChinese || petItem.name
      : petItem.name || petItem.nameChinese
    : t.mascotSelectedPlace;
  return (
    <>
      <div
        ref={container}
        className="map-canvas"
        role="region"
        aria-label={t.map}
        data-attempt={attempt}
      />
      <SelectedPet
        map={readyMap}
        target={petTarget}
        label={`${t.mascotInspect}: ${petName}`}
        animate={effects}
        onActivate={() => {
          if (!petTarget) return;
          if (extraSelectedKey) onSelectExtra?.(petTarget.key);
          else onSelect(petTarget.key);
        }}
      />
    </>
  );
}
