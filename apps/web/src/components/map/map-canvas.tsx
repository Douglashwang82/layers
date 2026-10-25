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
import {
  googleMarkerKinds,
  markerKinds,
  maxMapPoints,
  type Bounds,
  type GoogleMarkerKind,
  type ItemType,
} from "@taiwanhub/shared";
import type { MapItem } from "@/features/map/query";
import type { Copy, Locale } from "@/lib/dictionary";
import "mapbox-gl/dist/mapbox-gl.css";
import { mapboxTransformRequest } from "@/lib/browser-api-log";
import {
  applyJadeAtlas,
  atlasPalettes,
  atlasStyles,
  flatMapOptions,
  type AtlasTheme,
} from "@/lib/map-appearance";
import {
  markerChrome,
  markerColorExpressionFor,
  markerGlyphImage,
  markerImageId,
  markerKind,
  markerPalettes,
} from "@/lib/marker-presentation";
export type MapCanvasHandle = {
  fitTo: (items: MapItem[]) => void;
  /** Current camera center, used to bias provider search toward what the user sees. */
  getCenter: () => { lat: number; lng: number } | null;
  /** Frame provider search results, which often fall outside the current view. */
  fitPoints: (points: { lat: number; lng: number }[]) => void;
  /** Center a provider-resolved point, respecting reduced motion and panel padding. */
  focusPoint: (point: { lat: number; lng: number }) => void;
  fitBounds: (bounds: Bounds) => void;
  /** Pan only when a point sits outside the visible (unpadded) area; never changes zoom. */
  revealPoint: (point: { lat: number; lng: number }) => void;
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
  /** LocalLink-authored label (the pasted link's name, else a layer note). */
  label?: string;
  /** Tabelog search for a Google food place in Japan that has a link name. */
  tabelog?: { name: string; url: string };
  /** Pin color from the place's Google types; uncolored until they are known. */
  marker?: GoogleMarkerKind;
};
/** Route stops in order: numbered badges joined by a dashed line (order only, not roads). */
function routeGeoJSON(stops: { lat: number; lng: number }[]) {
  const coordinates = stops.map((s) => [s.lng, s.lat]);
  return {
    type: "FeatureCollection" as const,
    features: [
      ...(stops.length > 1
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: { type: "LineString" as const, coordinates },
            },
          ]
        : []),
      ...coordinates.map((point, i) => ({
        type: "Feature" as const,
        properties: { n: i + 1 },
        geometry: { type: "Point" as const, coordinates: point },
      })),
    ],
  };
}
function extraGeoJSON(points: ExtraPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((p) => ({
      type: "Feature" as const,
      properties: {
        key: p.key,
        kind: p.kind,
        ...(p.marker ? { marker: p.marker } : {}),
      },
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
/** The selected pin's short label, in the interface language. */
function labelOf(item: MapItem, locale: Locale) {
  return locale === "zh-TW"
    ? item.nameChinese || item.name
    : item.name || item.nameChinese;
}
function toGeoJSON(items: MapItem[], locale: Locale) {
  return {
    type: "FeatureCollection" as const,
    features: items
      .filter((i) => i.latitude != null && i.longitude != null)
      .map((i) => ({
        type: "Feature" as const,
        properties: {
          key: i.key,
          type: i.type,
          kind: markerKind(i),
          label: labelOf(i, locale),
        },
        geometry: {
          type: "Point" as const,
          coordinates: [i.longitude!, i.latitude!],
        },
      })),
  };
}
const noPoints: ExtraPoint[] = [];
const noStops: { lat: number; lng: number }[] = [];
export function MapCanvas({
  ref,
  token,
  items,
  selectedKey,
  extraPoints = noPoints,
  route = noStops,
  extraSelectedKey = null,
  effects = false,
  center,
  zoom,
  locale,
  theme = "light",
  t,
  padding,
  highlightKey = null,
  onItemHover,
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
  /** Planned route stops, in order. */
  route?: { lat: number; lng: number }[];
  extraSelectedKey?: string | null;
  /** Presentation-only selection effects (FEATURE_MAP_EFFECTS). */
  effects?: boolean;
  onSelectExtra?: (key: string) => void;
  center: [number, number];
  zoom: number;
  locale: Locale;
  /** A theme change rebuilds the map with the matching provider style. */
  theme?: AtlasTheme;
  t: Copy;
  padding: { top: number; right: number; bottom: number; left: number };
  /** A list row under the pointer or focus; highlights its pin without moving the camera. */
  highlightKey?: string | null;
  /** Pin hover after a short dwell (null when it ends); positions are container pixels. */
  onItemHover?: (hover: { key: string; x: number; y: number } | null) => void;
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
  // Survives rebuilds (theme change, retry) so the user keeps their view.
  const cameraRef = useRef<{ center: [number, number]; zoom: number } | null>(
    null,
  );
  // The canvas keeps its point budget: extra points reserve room within it.
  const catalogItems = useMemo(
    () => items.slice(0, Math.max(0, maxMapPoints - extraPoints.length)),
    [items, extraPoints.length],
  );
  const latest = useRef({
    locale,
    items: catalogItems,
    extraPoints,
    route,
    extraSelectedKey,
    effects,
    onSelectExtra,
    selectedKey,
    onSelect,
    onUserMove,
    onStatus,
    onLocationDenied,
    padding,
    highlightKey,
    onItemHover,
  });
  const mapHoverKey = useRef<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    latest.current = {
      locale,
      items: catalogItems,
      extraPoints,
      route,
      extraSelectedKey,
      effects,
      onSelectExtra,
      selectedKey,
      onSelect,
      onUserMove,
      onStatus,
      onLocationDenied,
      padding,
      highlightKey,
      onItemHover,
    };
  });
  const [attempt, setAttempt] = useState(0);
  /** The enlarged hover pin: list highlight wins over map hover; the selected pin is never doubled. */
  function syncHover(map: MapboxMap) {
    const {
      highlightKey: listKey,
      items: all,
      locale: lang,
      selectedKey: chosen,
    } = latest.current;
    const key = listKey ?? mapHoverKey.current;
    (map.getSource("hover-item") as GeoJSONSource | undefined)?.setData(
      toGeoJSON(
        key && key !== chosen ? all.filter((i) => i.key === key) : [],
        lang,
      ),
    );
  }
  /**
   * With effects on, a selection dims other pins (still legible, never hidden)
   * and changes ease in. Reduced motion keeps the dimming but not the easing.
   */
  function applyEffects(map: MapboxMap) {
    const { effects: on, selectedKey: a, extraSelectedKey: b } = latest.current;
    const opacity = on && (a || b) ? 0.55 : 1;
    const duration = on && !prefersReducedMotion() ? 200 : 0;
    for (const layer of [
      "points",
      "extra-points",
      "point-icons",
      "extra-icons",
    ]) {
      if (!map.getLayer(layer)) continue;
      const prop = layer.endsWith("-icons") ? "icon-opacity" : "circle-opacity";
      map.setPaintProperty(layer, `${prop}-transition`, { duration, delay: 0 });
      map.setPaintProperty(layer, prop, opacity);
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
        padding: latest.current.padding,
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
        padding: latest.current.padding,
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
      mapRef.current?.fitBounds(bounds, {
        padding: latest.current.padding,
        duration: 0,
      });
    },
    revealPoint(point) {
      const map = mapRef.current;
      if (!map) return;
      const spot = map.project([point.lng, point.lat]);
      const pad = map.getPadding();
      const view = map.getContainer();
      const margin = 48;
      const visible =
        spot.x >= (pad.left ?? 0) + margin &&
        spot.x <= view.clientWidth - (pad.right ?? 0) - margin &&
        spot.y >= (pad.top ?? 0) + margin &&
        spot.y <= view.clientHeight - (pad.bottom ?? 0) - margin;
      if (!visible)
        map.easeTo({
          center: [point.lng, point.lat],
          duration: prefersReducedMotion() ? 0 : 240,
        });
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
          transformRequest: mapboxTransformRequest,
          style: atlasStyles[theme],
          center: cameraRef.current?.center ?? center,
          zoom: cameraRef.current?.zoom ?? zoom,
          attributionControl: true,
          cooperativeGestures: false,
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        mapRef.current = map;
        dispose = () => {
          window.clearTimeout(hoverTimer.current);
          setReadyMap(null);
          mapRef.current = null;
          map.remove();
        };
        map.addControl(
          new mapboxgl.NavigationControl({ showCompass: false }),
          "bottom-right",
        );
        const geolocate = new mapboxgl.GeolocateControl({
          fitBoundsOptions: {
            maxZoom: 15,
            get padding() {
              return latest.current.padding;
            },
            get duration() {
              return prefersReducedMotion() ? 0 : 240;
            },
          },
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
        map.on("load", () => {
          window.clearTimeout(timeout);
          if (stopped) return;
          applyJadeAtlas(map, locale, theme);
          const palette = atlasPalettes[theme];
          const chrome = markerChrome[theme];
          const markerColorExpression = markerColorExpressionFor(theme);
          const text = palette.ink;
          const colors: Record<ItemType, string> = {
            place: palette.place,
            event: palette.event,
            content: palette.content,
          };
          // Quiet dots: the type is repeated in the list and the selected label.
          map.addSource("items", {
            type: "geojson",
            data: toGeoJSON(latest.current.items, latest.current.locale),
            cluster: true,
            clusterRadius: 48,
            clusterMaxZoom: 16,
            promoteId: "key",
          });
          // A selected point remains visible even inside a cluster.
          map.addSource("selected-item", {
            type: "geojson",
            data: toGeoJSON(
              latest.current.items.filter(
                (item) => item.key === latest.current.selectedKey,
              ),
              latest.current.locale,
            ),
          });
          map.addLayer({
            id: "clusters",
            type: "circle",
            source: "items",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": palette.surface,
              "circle-stroke-color": palette.primary,
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
            source: "selected-item",
            filter: ["==", ["get", "key"], latest.current.selectedKey ?? ""],
            paint: {
              "circle-radius": 13,
              "circle-color": palette.surface,
              "circle-opacity": 0.85,
              "circle-stroke-color": text,
              "circle-stroke-width": 2,
            },
          });
          // Pins are colored by marker kind; a dark under-ring keeps pale
          // kinds legible on the light basemap and kind is also in the list.
          const radius = (base: number, big: number) => [
            "interpolate",
            ["linear"],
            ["zoom"],
            12,
            base,
            15,
            big,
          ];
          map.addLayer({
            id: "points-edge",
            type: "circle",
            source: "items",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-radius": radius(
                5.5 + chrome.edgeGrow,
                9.5 + chrome.edgeGrow,
              ) as never,
              "circle-color": chrome.edge ?? markerColorExpression,
              "circle-opacity": chrome.edgeOpacity,
              "circle-blur": chrome.edgeBlur,
            },
          });
          map.addLayer({
            id: "points",
            type: "circle",
            source: "items",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-radius": radius(5.5, 9.5) as never,
              "circle-color": markerColorExpression,
              "circle-stroke-color": chrome.stroke,
              "circle-stroke-width": 1.5,
            },
          });
          // Hover/list highlight: a single enlarged pin above the rest.
          map.addSource("hover-item", {
            type: "geojson",
            data: toGeoJSON([], latest.current.locale),
          });
          map.addLayer({
            id: "hover-point",
            type: "circle",
            source: "hover-item",
            paint: {
              "circle-radius": radius(6.5, 11) as never,
              "circle-color": markerColorExpression,
              "circle-stroke-color": chrome.outline,
              "circle-stroke-width": 2,
              "circle-radius-transition": { duration: 150, delay: 0 },
            },
          });
          for (const kind of markerKinds) {
            const image = markerGlyphImage(kind, theme);
            if (image && !map.hasImage(markerImageId(kind)))
              map.addImage(markerImageId(kind), image, { pixelRatio: 2 });
          }
          map.addLayer({
            id: "point-icons",
            type: "symbol",
            source: "items",
            minzoom: 14,
            filter: ["!", ["has", "point_count"]],
            layout: {
              "icon-image": ["concat", "marker-", ["get", "kind"]],
              "icon-size": 0.55,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
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
            id: "selected-label",
            type: "symbol",
            source: "selected-item",
            filter: ["==", ["get", "key"], latest.current.selectedKey ?? ""],
            layout: {
              "text-field": ["get", "label"],
              "text-size": 13,
              "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
              "text-anchor": "top",
              "text-offset": [0, 1.3],
              "text-max-width": 12,
              "text-allow-overlap": true,
            },
            paint: {
              "text-color": text,
              "text-halo-color": palette.surface,
              "text-halo-width": 2,
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
              "circle-radius": 20,
              "circle-color": palette.surface,
              "circle-opacity": 0.85,
              "circle-stroke-color": text,
              "circle-stroke-width": 2,
            },
          });
          map.addLayer({
            id: "extra-points",
            type: "circle",
            source: "places-extra",
            paint: {
              // Larger than catalog dots; search results are hollow, saved/layer
              // external places are filled with their type's marker color.
              "circle-radius": 10,
              "circle-color": [
                "case",
                ["==", ["get", "kind"], "search"],
                palette.surface,
                ["has", "marker"],
                [
                  "match",
                  ["get", "marker"],
                  ...googleMarkerKinds.flatMap((k) => [
                    k,
                    markerPalettes[theme][k],
                  ]),
                  colors.place,
                ],
                colors.place,
              ] as never,
              "circle-stroke-color": text,
              "circle-stroke-width": 2.5,
            },
          });
          // Close in, a typed place also shows its kind's glyph, as catalog pins do.
          map.addLayer({
            id: "extra-icons",
            type: "symbol",
            source: "places-extra",
            minzoom: 14,
            filter: ["has", "marker"],
            layout: {
              "icon-image": ["concat", "marker-", ["get", "marker"]],
              "icon-size": 0.55,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
          });
          // The route line runs under the pins; numbered badges sit on top.
          // Clicks fall through to the pin layers, which toggle the stop.
          map.addSource("route", {
            type: "geojson",
            data: routeGeoJSON(latest.current.route),
          });
          map.addLayer(
            {
              id: "route-line",
              type: "line",
              source: "route",
              filter: ["==", ["geometry-type"], "LineString"],
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": text,
                "line-width": 2.5,
                "line-opacity": 0.8,
                "line-dasharray": [2, 1.5],
              },
            },
            "points-edge",
          );
          map.addLayer({
            id: "route-stop",
            type: "circle",
            source: "route",
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
              "circle-radius": 11,
              "circle-color": text,
              "circle-stroke-color": palette.surface,
              "circle-stroke-width": 2,
            },
          });
          map.addLayer({
            id: "route-stop-number",
            type: "symbol",
            source: "route",
            filter: ["==", ["geometry-type"], "Point"],
            layout: {
              "text-field": ["to-string", ["get", "n"]],
              "text-size": 12,
              "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: { "text-color": palette.surface },
          });
          map.on("click", "extra-points", (e) => {
            const key = (e.features?.[0] as Feature | undefined)?.properties
              ?.key;
            if (key) latest.current.onSelectExtra?.(String(key));
          });
          applyEffects(map);
          map.on("click", ["points-hit", "selected-halo"], (e) => {
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
          for (const layer of ["points-hit", "clusters", "extra-points"]) {
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
          // Pin hover: immediate highlight, tooltip after a 250ms dwell.
          // Google places (extra points) share it; their keys match no catalog pin.
          for (const layer of ["points-hit", "extra-points"]) {
            map.on("mousemove", layer, (e) => {
              const key = (e.features?.[0] as Feature | undefined)?.properties
                ?.key;
              if (!key || String(key) === mapHoverKey.current) return;
              mapHoverKey.current = String(key);
              window.clearTimeout(hoverTimer.current);
              latest.current.onItemHover?.(null);
              syncHover(map);
              const spot = { x: e.point.x, y: e.point.y };
              hoverTimer.current = window.setTimeout(
                () =>
                  latest.current.onItemHover?.({
                    key: String(key),
                    ...spot,
                  }),
                250,
              );
            });
            map.on("mouseleave", layer, () => {
              mapHoverKey.current = null;
              window.clearTimeout(hoverTimer.current);
              latest.current.onItemHover?.(null);
              syncHover(map);
            });
          }
          const markUser = (e: unknown) => {
            if ((e as { originalEvent?: unknown }).originalEvent)
              userMovedRef.current = true;
          };
          map.on("dragstart", markUser);
          map.on("zoomstart", markUser);
          map.on("wheel", () => (userMovedRef.current = true));
          map.on("moveend", () => {
            const c = map.getCenter();
            cameraRef.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
            // The settled camera, readable from the page (e.g. by browser tests).
            map
              .getContainer()
              .setAttribute(
                "data-camera",
                `${c.lng.toFixed(3)},${c.lat.toFixed(3)},${map.getZoom().toFixed(1)}`,
              );
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
  }, [token, attempt, theme]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("items") as GeoJSONSource | undefined)?.setData(
      toGeoJSON(catalogItems, locale),
    );
  }, [catalogItems, locale, readyMap]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("places-extra") as GeoJSONSource | undefined)?.setData(
      extraGeoJSON(extraPoints),
    );
  }, [extraPoints]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("route") as GeoJSONSource | undefined)?.setData(
      routeGeoJSON(route),
    );
  }, [route, readyMap]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    syncHover(map);
  }, [highlightKey, items, selectedKey, locale, readyMap]);
  // A brief ring on selection, once; never a loop and not under reduced motion.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !selectedKey || !effects) return;
    if (prefersReducedMotion() || !map.getLayer("selected-halo")) return;
    map.setPaintProperty("selected-halo", "circle-radius-transition", {
      duration: 0,
      delay: 0,
    });
    map.setPaintProperty("selected-halo", "circle-radius", 22);
    const frame = window.requestAnimationFrame(() => {
      map.setPaintProperty("selected-halo", "circle-radius-transition", {
        duration: 250,
        delay: 0,
      });
      map.setPaintProperty("selected-halo", "circle-radius", 13);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedKey, effects, readyMap]);
  // Selection is a filter/paint update on the stable map; it never remounts or refetches.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("selected-item") as GeoJSONSource | undefined)?.setData(
      toGeoJSON(
        items.filter((item) => item.key === selectedKey),
        locale,
      ),
    );
    for (const layer of ["selected-halo", "selected-label"])
      map.setFilter(layer, ["==", ["get", "key"], selectedKey ?? ""]);
    map.setFilter("extra-halo", ["==", ["get", "key"], extraSelectedKey ?? ""]);
    applyEffects(map);
  }, [selectedKey, extraSelectedKey, effects, items, locale, readyMap]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    // New padding moves the camera center to the middle of the new open area,
    // which would slide the map when the list opens or closes. Recenter on the
    // point already there so the view stays still. A running animation (a fit
    // or a reveal) keeps its target instead.
    if (map.isMoving()) {
      map.setPadding(padding);
      return;
    }
    const view = map.getContainer();
    const x =
      padding.left + (view.clientWidth - padding.left - padding.right) / 2;
    const y =
      padding.top + (view.clientHeight - padding.top - padding.bottom) / 2;
    map.jumpTo({ center: map.unproject([x, y]), padding });
  }, [padding]);
  // Base map labels follow the interface language; item titles are localized in the panel.
  useEffect(() => {
    if (readyMap) applyJadeAtlas(readyMap, locale, theme);
  }, [locale, readyMap, theme]);
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
      data-theme={theme}
      data-attempt={attempt}
    />
  );
}
