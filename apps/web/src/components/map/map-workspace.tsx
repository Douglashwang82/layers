"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  List,
  Map as MapIcon,
  Layers as LayersIcon,
  Crosshair,
  Info,
  Route,
  X,
} from "lucide-react";
import {
  googleMarkerKinds,
  itemTypes,
  localDate,
  parseMapQuery,
  serializeMapQuery,
  type Bounds,
  type MapState,
} from "@taiwanhub/shared";
import type {
  LayerAvailability,
  MapCity,
  MapQueryResult,
} from "@/features/map/query";
import type { ItemDetail } from "@/features/map/detail";
import {
  type Copy,
  type Locale,
  format,
  localized as localizedName,
} from "@/lib/dictionary";
import {
  MapCanvas,
  type CanvasStatus,
  type ExtraPoint,
  type MapCanvasHandle,
} from "./map-canvas";
import { getPlacesProvider, type ProviderPlace } from "@/lib/places/provider";
import { BusinessDiscovery } from "@/components/places/business-discovery";
import { BusinessPanel } from "@/components/places/business-panel";
import { ExternalReferences } from "@/components/places/external-references";
import { ProviderDetails } from "@/components/places/provider-slot";
import { MapToolbar } from "./map-toolbar";
import { MarkerLegend } from "./marker-legend";
import {
  markerCssVars,
  markerKind,
  markerLabel,
} from "@/lib/marker-presentation";
import { useMapTheme } from "@/lib/map-theme";
import { ActiveLayersPanel } from "./active-layers-panel";
import { MapResults, TabelogLink } from "./map-results";
import { tabelogLink } from "@/lib/tabelog";
import { ItemPreview } from "./item-preview";
import { RoutePlanner, type PlannedStop } from "./route-planner";
import {
  maxRouteStops,
  routeLinks,
  shortOrder,
  type TravelMode,
} from "@/lib/route-link";
import { DailyPickCard } from "@/components/daily-pick/daily-pick-card";
import { track } from "@/lib/track";
import { eventRange, eventTitle } from "@/lib/event-time";
import { mapSessionKey } from "@/lib/map-session";
import {
  initialPanelOpen,
  mapPadding,
  panelStorageKey,
  panelVisible,
  storedPanelOpen,
} from "@/lib/map-panel";
/** Mobile sheet height; the sheet is closed when the panel is not open. */
type Sheet = "half" | "expanded";
/** Camera zoom showing a whole city, at start and after switching cities. */
const cityZoom = 10.5;
/** Wait for the panel and padding to settle before moving the camera. */
const afterLayout = (run: () => void) => window.setTimeout(run, 80);
/** The Google place hover card's size (height approximate), for keeping it inside the map. */
const placeTipWidth = 280;
const placeTipHeight = 360;
/** Server-read flags and the browser-visible provider key (only when discovery or the MVP is on). */
export type PlacesConfig = {
  providerKey: string | null;
  reviewWrites: boolean;
  collections: boolean;
  mapEffects: boolean;
  /** Map MVP: layers only — no search, discovery or system layers. */
  mvp: boolean;
};
/** An in-memory business selection; it never enters the URL until a subject exists. */
type BusinessSelection = {
  key: string;
  placeId: string | null;
  subjectId: string | null;
  location: { lat: number; lng: number } | null;
  temporary: boolean;
};
function keyOf(state: MapState, includeCity: boolean) {
  return serializeMapQuery(
    {
      ...state,
      layers:
        state.layers === "none" || state.layers.length === 0
          ? "none"
          : state.layers,
      item: undefined,
      view: undefined,
      page: undefined,
    },
    { includeCity },
  );
}
function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
/**
 * The map state controller. The URL is the single source of truth for public
 * state; this component only writes it through pushState/replaceState and
 * re-queries when the committed query changes. Camera movement, hover and
 * sheet position stay local. The Mapbox instance lives in MapCanvas and
 * survives every state change.
 */
export function MapWorkspace({
  initial,
  initialDetail,
  city,
  t,
  locale,
  authenticated,
  token,
  hasDemo,
  contentEnabled,
  layerWrites,
  places,
  library = null,
}: {
  initial: MapQueryResult;
  initialDetail: ItemDetail | null;
  city: MapCity;
  t: Copy;
  locale: Locale;
  authenticated: boolean;
  token: string | undefined;
  hasDemo: boolean;
  contentEnabled: boolean;
  layerWrites: boolean;
  places: PlacesConfig;
  /** Map MVP: the signed-in member's loadable layers. */
  library?: LayerAvailability[] | null;
}) {
  const mvp = places.mvp;
  const searchParams = useSearchParams();
  const canvas = useRef<MapCanvasHandle>(null);
  const { theme } = useMapTheme();
  // Tokens live on body (the header sits outside the workspace), so publish the theme there.
  useEffect(() => {
    document.body.dataset.mapTheme = theme;
    return () => {
      delete document.body.dataset.mapTheme;
    };
  }, [theme]);
  const hasExplicitCity = searchParams.has("city");
  const state = useMemo<MapState>(() => {
    const parsed = parseMapQuery(Object.fromEntries(searchParams));
    return {
      ...parsed,
      city: city.slug,
      layers: parsed.layers ?? initial.state.layers,
    };
  }, [searchParams, city.slug, initial.state.layers]);
  const queryKey = keyOf(state, true);
  const listView = state.view === "list";
  // Declared early: effects below open the panel when a selection arrives.
  const [panelOpen, setPanelOpen] = useState(() =>
    initialPanelOpen({
      hasItem: !!state.item,
      listView,
      fallback: !token,
    }),
  );
  /* Results: keep the previous dataset usable during refresh; ignore stale responses. */
  const [result, setResult] = useState(initial);
  const resultKey = useRef(keyOf(initial.state, true));
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [force, setForce] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    setResult(initial);
    resultKey.current = keyOf(initial.state, true);
  }, [initial]);
  useEffect(() => {
    if (queryKey === resultKey.current && force === 0) return;
    const id = ++seq.current;
    const controller = new AbortController();
    setRefreshing(true);
    fetch("/api/v1/map" + queryKey, { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        if (id !== seq.current) return;
        if (json.error) throw new Error(json.error.message);
        resultKey.current = queryKey;
        setResult(json.data as MapQueryResult);
        setLoadError(null);
      })
      .catch((e: Error) => {
        if (e.name === "AbortError" || id !== seq.current) return;
        setLoadError(e.message || t.error);
      })
      .finally(() => {
        if (id === seq.current) setRefreshing(false);
      });
    return () => controller.abort();
  }, [queryKey, force, t.error]);
  /* URL writes */
  const commit = useCallback(
    (patch: Partial<MapState>, mode: "push" | "replace" = "push") => {
      const next = { ...state, ...patch };
      const qs = serializeMapQuery(
        {
          ...next,
          layers:
            next.layers === "none" || next.layers.length === 0
              ? "none"
              : next.layers,
        },
        { includeCity: hasExplicitCity },
      );
      window.history[mode === "push" ? "pushState" : "replaceState"](
        null,
        "",
        "/" + qs,
      );
    },
    [state, hasExplicitCity],
  );
  useEffect(() => {
    try {
      sessionStorage.setItem(mapSessionKey, keyOf(state, hasExplicitCity));
    } catch {
      /* private mode */
    }
  }, [state, hasExplicitCity]);
  useEffect(() => {
    track("map_opened", { city: city.slug });
  }, [city.slug]);
  /* Layers */
  const [hiddenLayers, setHiddenLayers] = useState<LayerAvailability[]>([]);
  const appliedSlugs = state.layers === "none" ? [] : state.layers;
  // Toggles acknowledge input immediately; the URL and results catch up asynchronously.
  const [optimisticLayers, setOptimisticLayers] = useState<string[] | null>(
    null,
  );
  useEffect(() => {
    setOptimisticLayers(null);
  }, [state.layers]);
  const shownSlugs = optimisticLayers ?? appliedSlugs;
  const persist = useCallback(
    (layers: string[], view: MapState["view"]) => {
      if (!authenticated) return;
      // keepalive so a quick navigation away never loses the preference.
      fetch("/api/v1/map/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layers, view }),
        keepalive: true,
      }).catch(() => {});
    },
    [authenticated],
  );
  const toggleLayer = (slug: string, applied: boolean) => {
    const next = applied
      ? [...shownSlugs, slug]
      : shownSlugs.filter((s) => s !== slug);
    const entry = result.layers.find((l) => l.slug === slug);
    if (!applied && entry)
      setHiddenLayers((h) => [...h.filter((x) => x.slug !== slug), entry]);
    if (applied) setHiddenLayers((h) => h.filter((x) => x.slug !== slug));
    setOptimisticLayers(next);
    commit({ layers: next.length ? next : "none" });
    track(applied ? "layer_applied" : "layer_hidden", { layer: slug });
  };
  const onlyLayer = (slug: string) => {
    const others = result.layers.filter(
      (l) => l.slug !== slug && l.status === "ok",
    );
    setHiddenLayers((h) => [
      ...others,
      ...h.filter(
        (x) => x.slug !== slug && !others.some((o) => o.slug === x.slug),
      ),
    ]);
    setOptimisticLayers([slug]);
    commit({ layers: [slug] });
  };
  // Whatever is applied, by toggle or by explicit link, becomes the returning user's default.
  const appliedKey = appliedSlugs.join(",");
  useEffect(() => {
    persist(appliedKey ? appliedKey.split(",") : [], state.view);
  }, [appliedKey, state.view, persist]);
  /* Selection */
  const selectedKey = state.item ?? null;
  const selected = result.items.find((i) => i.key === selectedKey) ?? null;
  const pushedSelection = useRef(false);
  const [detail, setDetail] = useState<{
    key: string | null;
    data: ItemDetail | null;
    loading: boolean;
    error: string | null;
  }>({
    key: initialDetail ? selectedKey : null,
    data: initialDetail,
    loading: false,
    error: null,
  });
  const detailSeq = useRef(0);
  const loadDetail = useCallback(
    (key: string) => {
      const id = ++detailSeq.current;
      setDetail((d) => ({
        key,
        data: d.key === key ? d.data : null,
        loading: true,
        error: null,
      }));
      fetch("/api/v1/map/item?key=" + encodeURIComponent(key))
        .then((r) => r.json())
        .then((json) => {
          if (id !== detailSeq.current) return;
          if (json.error) throw new Error(json.error.message);
          setDetail({
            key,
            data: json.data as ItemDetail,
            loading: false,
            error: null,
          });
        })
        .catch((e: Error) => {
          if (id !== detailSeq.current) return;
          setDetail({
            key,
            data: null,
            loading: false,
            error: e.message || t.error,
          });
        });
    },
    [t.error],
  );
  useEffect(() => {
    if (!selectedKey) return;
    if (detail.key === selectedKey && (detail.data || detail.loading)) return;
    loadDetail(selectedKey);
  }, [selectedKey, detail.key, detail.data, detail.loading, loadDetail]);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (
      selectedKey &&
      !selected &&
      !refreshing &&
      resultKey.current === queryKey
    ) {
      commit({ item: undefined }, "replace");
      setAnnounce(t.selectionCleared);
    }
  }, [selectedKey, selected, refreshing, queryKey, commit, t.selectionCleared]);
  // Layers can be shown over an open detail; any new selection brings detail back.
  const [detailHidden, setDetailHidden] = useState(false);
  useEffect(() => {
    setDetailHidden(false);
    if (selectedKey) setPanelOpen(true);
  }, [selectedKey]);
  const reveal = () => {
    setDetailHidden(false);
    setPanelOpen(true);
  };
  const select = (key: string) => {
    reveal();
    setBusiness(null);
    commit({ item: key }, "push");
    pushedSelection.current = true;
    setSheet("half");
    track("map_item_selected", { type: key.split(":")[0] });
  };
  const closeDetail = () => {
    if (pushedSelection.current) {
      pushedSelection.current = false;
      window.history.back();
    } else commit({ item: undefined }, "replace");
  };
  /* Pin hover: list rows highlight pins; pins show a tooltip after a dwell. */
  const [listHoverKey, setListHoverKey] = useState<string | null>(null);
  const [tip, setTip] = useState<{
    key: string;
    x: number;
    y: number;
    above?: boolean;
  } | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  const stageBody = useRef<HTMLDivElement>(null);
  /* Business discovery: a separate mode and in-memory selection, lazily loading the provider. */
  const provider = useMemo(
    () => getPlacesProvider(places.providerKey ?? undefined, locale),
    [places.providerKey, locale],
  );
  const [mode, setMode] = useState<"layers" | "business">("layers");
  const [business, setBusiness] = useState<BusinessSelection | null>(null);
  const [searchPoints, setSearchPoints] = useState<ExtraPoint[]>([]);
  const [externalPoints, setExternalPoints] = useState<ExtraPoint[]>([]);
  const extraPoints = useMemo(() => {
    const points = [...externalPoints, ...searchPoints];
    if (business?.location && !points.some((p) => p.key === business.key))
      points.push({
        key: business.key,
        kind: business.temporary ? "search" : "external",
        lat: business.location.lat,
        lng: business.location.lng,
        placeId: business.placeId ?? undefined,
      });
    return points;
  }, [externalPoints, searchPoints, business]);
  const onItemHover = (hover: { key: string; x: number; y: number } | null) => {
    window.clearTimeout(tipTimer.current);
    if (hover) {
      // Keep the tooltip inside the map: clamp against the stage size at event
      // time. A Google place card is wider and taller, and flips above the
      // pointer near the bottom edge.
      const stage = stageBody.current;
      const width = stage?.clientWidth ?? 1024;
      const height = stage?.clientHeight ?? 768;
      const card = extraPoints.some((p) => p.key === hover.key && p.placeId);
      const [w, h] = card ? [placeTipWidth, placeTipHeight] : [234, 0];
      const above = hover.y + 14 + h > height && hover.y - 14 - h > 0;
      setTip({
        key: hover.key,
        x: Math.max(8, Math.min(hover.x + 14, width - w - 14)),
        // Above the pointer, `y` is the card's bottom edge.
        y: above ? hover.y - 14 : Math.max(8, hover.y + 14),
        above,
      });
    }
    // A short grace lets the pointer move onto the tooltip to read it.
    else tipTimer.current = window.setTimeout(() => setTip(null), 160);
  };
  /** A marker clicked on the map is already in view, so the camera stays put. */
  const selectBusiness = (next: BusinessSelection, moveCamera = true) => {
    reveal();
    setBusiness(next);
    setSheet("half");
    const spot = next.location;
    if (spot && moveCamera) afterLayout(() => canvas.current?.focusPoint(spot));
  };
  const selectSearchPlace = (place: ProviderPlace) =>
    selectBusiness({
      key: `search:${place.id}`,
      placeId: place.id,
      subjectId: null,
      location: place.location,
      temporary: true,
    });
  const closeBusiness = () => {
    setBusiness(null);
    panelRef.current?.focus();
  };
  /*
   * Route planning (map MVP, docs/plans/map-route-links-plan.md): stops are
   * added from a place's hover card or details, or all at once from the
   * results; markers always open the place. A route bar shows while there
   * are stops, and the planner opens from it. Stops stay in memory for this
   * page view.
   */
  const [routeOpen, setRouteOpen] = useState(false);
  const [routeStops, setRouteStops] = useState<PlannedStop[]>([]);
  const [travelMode, setTravelMode] = useState<TravelMode>("walking");
  const [routeNotice, setRouteNotice] = useState("");
  const routeLine = useMemo(
    () => routeStops.map(({ lat, lng }) => ({ lat, lng })),
    [routeStops],
  );
  const toggleStop = (stop: PlannedStop) => {
    if (routeStops.some((s) => s.key === stop.key)) {
      setRouteStops(routeStops.filter((s) => s.key !== stop.key));
      setRouteNotice(t.routeStopRemoved);
    } else if (routeStops.length >= maxRouteStops)
      setRouteNotice(format(t.routeFull, { max: maxRouteStops }));
    else {
      setRouteStops([...routeStops, stop]);
      setRouteNotice(format(t.routeStopAdded, { n: routeStops.length + 1 }));
    }
  };
  const itemStop = (key: string): PlannedStop | null => {
    const item = result.items.find((i) => i.key === key);
    if (!item || item.latitude == null || item.longitude == null) return null;
    return {
      key,
      lat: item.latitude,
      lng: item.longitude,
      label: localizedName(item, locale),
    };
  };
  const pointStop = (point: ExtraPoint): PlannedStop => ({
    key: point.key,
    lat: point.lat,
    lng: point.lng,
    placeId: point.placeId ?? null,
    label: point.label || t.routeGooglePlace,
  });
  /** A map pin as a stop; temporary search results never join a route. */
  const stopFor = (key: string): PlannedStop | null => {
    const point = extraPoints.find((p) => p.key === key);
    if (point) return point.kind === "external" ? pointStop(point) : null;
    return itemStop(key);
  };
  const onSelectExtra = (key: string) => {
    const point = extraPoints.find((p) => p.key === key);
    if (!point) return;
    selectBusiness(
      {
        key,
        placeId: point.placeId ?? null,
        subjectId: key.startsWith("subject:") ? key.slice(8) : null,
        location: { lat: point.lat, lng: point.lng },
        temporary: point.kind === "search",
      },
      false,
    );
  };
  /* Camera and area */
  const [pendingArea, setPendingArea] = useState<Bounds | null>(null);
  const [canvasStatus, setCanvasStatus] = useState<CanvasStatus>(
    token ? "loading" : "failed",
  );
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const fittedOnce = useRef(false);
  const onStatus = (status: CanvasStatus) => {
    setCanvasStatus(status);
    if (status === "failed")
      track("map_fallback_used", { reason: token ? "provider" : "token" });
  };
  useEffect(() => {
    if (canvasStatus !== "ready" || fittedOnce.current) return;
    fittedOnce.current = true;
    if (state.area) canvas.current?.fitBounds(state.area);
    else if (
      appliedSlugs.length === 1 &&
      result.layers[0]?.ownerKind !== "system"
    )
      canvas.current?.fitTo(result.items);
  }, [canvasStatus, state.area, appliedSlugs.length, result]);
  const searchArea = () => {
    if (!pendingArea) return;
    commit({ area: pendingArea });
    setPendingArea(null);
    track("map_area_searched", {});
  };
  /*
   * MVP framing: every loaded place (catalog/custom pins and Google places as
   * they resolve) stays in view until the user moves the map themselves; a
   * new set of layers starts framing again.
   */
  const autoFit = useRef<string | null>(null);
  const onUserMove = (bounds: Bounds) => {
    if (mvp) autoFit.current = null;
    else setPendingArea(bounds);
  };
  /* Layout: everything floats over one full-viewport map; the list is a collapsible panel. */
  const mobile = useMedia("(max-width: 800px)");
  // Without a token or after a provider failure the list is the product and cannot be hidden.
  const fallback = !token || canvasStatus === "failed";
  const visible = panelVisible({ open: panelOpen, listView, fallback });
  const savedScroll = useRef(0);
  const wasDetail = useRef(false);
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const showingDetail = (!!selected || !!business) && !detailHidden;
    if (showingDetail !== wasDetail.current) {
      if (showingDetail) {
        node.scrollTop = 0;
      } else {
        node.scrollTop = savedScroll.current;
      }
      wasDetail.current = showingDetail;
    }
  }, [selected, business, detailHidden]);
  // Shared item links, list view and fallback win over the remembered preference.
  useEffect(() => {
    const forced = !!state.item || listView || !token;
    if (mobile) {
      // Phones start with the entry button only.
      setPanelOpen(forced);
      return;
    }
    if (forced) return;
    try {
      const stored = storedPanelOpen(localStorage.getItem(panelStorageKey));
      if (stored !== null) setPanelOpen(stored);
    } catch {
      /* Storage may be unavailable; stay collapsed. */
    }
    // Only a breakpoint change re-seeds the panel; later URL changes must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile]);
  const launcher = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const togglePanel = (open: boolean) => {
    setPanelOpen(open);
    if (!mobile)
      try {
        localStorage.setItem(panelStorageKey, String(!open));
      } catch {
        /* Keep the in-memory preference. */
      }
    // Focus follows the control the user just used; hidden content leaves the tab order.
    window.requestAnimationFrame(() =>
      (open ? panelRef.current : launcher.current)?.focus(),
    );
  };
  const [sheet, setSheet] = useState<Sheet>("half");
  // An empty MVP map opens on the member's layers: loading one is the first step.
  const [tab, setTab] = useState<"layers" | "results">(() =>
    mvp && authenticated && appliedSlugs.length === 0 ? "layers" : "results",
  );
  /**
   * Google place cards locate their pins only while on screen, so when an
   * MVP map has places still waiting, the Results tab opens once per query;
   * located pins stay after the panel closes.
   */
  const [pendingExternal, setPendingExternal] = useState(0);
  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!mvp || !pendingExternal || revealedFor.current === queryKey) return;
    revealedFor.current = queryKey;
    setTab("results");
    setPanelOpen(true);
  }, [mvp, pendingExternal, queryKey]);
  const [limit, setLimit] = useState(20);
  const [panelHeight, setPanelHeight] = useState(0);
  const [panelRight, setPanelRight] = useState(0);
  const [topInset, setTopInset] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const measure = () => {
      const box = node.getBoundingClientRect();
      setPanelHeight(Math.round(box.height));
      setPanelRight(Math.round(box.right));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // The search cluster floats above the map; the panel and camera clear its measured bottom.
  useEffect(() => {
    const cluster = document.querySelector<HTMLElement>(".map-top-left");
    const measure = () => {
      setTopInset(Math.round(cluster?.getBoundingClientRect().bottom ?? 0));
      setViewportHeight(root.current?.clientHeight ?? window.innerHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (cluster) observer.observe(cluster);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const padding = useMemo(
    () =>
      mapPadding({
        mobile,
        listView,
        visible,
        panelRight,
        panelHeight,
        topInset,
        // Floating navigation and the list entry sit at the bottom of a phone.
        bottomInset: visible ? 76 : 128,
        viewportHeight,
      }),
    [
      mobile,
      listView,
      visible,
      panelRight,
      panelHeight,
      topInset,
      viewportHeight,
    ],
  );
  useEffect(() => {
    canvas.current?.resize();
  }, [state.view, sheet, visible, mobile]);
  // A selected pin hidden behind the panel or an edge is brought into view,
  // not zoomed, unless it was picked on the map: the camera then stays put.
  const selectedLat = selected?.latitude ?? null;
  const selectedLng = selected?.longitude ?? null;
  const pickedOnMap = useRef<string | null>(null);
  useEffect(() => {
    if (canvasStatus !== "ready" || selectedLat == null || selectedLng == null)
      return;
    if (pickedOnMap.current === selectedKey) return;
    pickedOnMap.current = null;
    const timer = afterLayout(() =>
      canvas.current?.revealPoint({ lat: selectedLat, lng: selectedLng }),
    );
    return () => window.clearTimeout(timer);
  }, [selectedKey, selectedLat, selectedLng, canvasStatus, padding]);
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setActionsTarget(document.getElementById("map-header-actions"));
  }, []);
  const showLayers = () => {
    setTab("layers");
    setMode("layers");
    setDetailHidden(true);
    setPanelOpen(true);
    window.requestAnimationFrame(() => panelRef.current?.focus());
  };
  const editRoute = () => {
    setRouteOpen(true);
    setPanelOpen(true);
    setSheet("half");
    setTip(null);
    window.requestAnimationFrame(() => panelRef.current?.focus());
  };
  const setView = (view: MapState["view"]) => {
    commit({ view }, "replace");
    try {
      localStorage.setItem("taiwanhub:map-view", view);
    } catch {
      /* ignore */
    }
  };
  /* New day notice for rolling layers */
  const [newDay, setNewDay] = useState(false);
  useEffect(() => {
    const check = () => {
      const generated = localDate(new Date(result.generatedAt), city.timezone);
      setNewDay(generated !== localDate(new Date(), city.timezone));
    };
    const timer = window.setInterval(check, 60000);
    return () => window.clearInterval(timer);
  }, [result.generatedAt, city.timezone]);
  useEffect(() => {
    setLimit(20);
  }, [result.total, result.generatedAt]);
  // MVP counts include Google places as they get a location (as placeCount).
  const announcedCount = mvp
    ? result.total + externalPoints.length
    : result.total;
  useEffect(() => {
    setAnnounce(format(t.resultsInArea, { count: announcedCount }));
  }, [announcedCount, result.generatedAt, t.resultsInArea]);
  const mapped = result.items.filter(
    (i) => i.latitude != null && i.longitude != null,
  );
  const unmapped = result.items.filter(
    (i) => i.latitude == null || i.longitude == null,
  );
  useEffect(() => {
    autoFit.current = appliedKey;
  }, [appliedKey]);
  /*
   * Choosing another city moves the camera there. The workspace (and the
   * Mapbox camera) survive the navigation, so the new city's center is
   * applied here, once the map is ready; framing loaded places stops so it
   * cannot pull the view back. Declared before the framing effect on purpose.
   */
  const cameraCity = useRef(city.slug);
  useEffect(() => {
    if (cameraCity.current === city.slug || canvasStatus !== "ready") return;
    cameraCity.current = city.slug;
    autoFit.current = null;
    setPendingArea(null);
    canvas.current?.flyTo([city.longitude, city.latitude], cityZoom);
  }, [city.slug, city.longitude, city.latitude, canvasStatus]);
  useEffect(() => {
    if (!mvp || canvasStatus !== "ready" || autoFit.current !== appliedKey)
      return;
    const points: ExtraPoint[] = [
      ...mapped.map((i) => ({
        key: i.key,
        kind: "external" as const,
        lat: i.latitude!,
        lng: i.longitude!,
      })),
      ...externalPoints,
    ];
    if (!points.length) return;
    // Google places resolve a few at a time; frame once a burst settles.
    const timer = window.setTimeout(
      () => canvas.current?.fitPoints(points),
      250,
    );
    return () => window.clearTimeout(timer);
    // `mapped` is derived from `result`; its identity changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mvp, canvasStatus, appliedKey, result, externalPoints]);
  const businessPanel = business && (
    <BusinessPanel
      key={business.key}
      provider={provider}
      placeId={business.placeId}
      subjectId={business.subjectId}
      temporary={business.temporary}
      authenticated={authenticated}
      flags={{
        reviewWrites: places.reviewWrites,
        collections: places.collections,
        layerWrites,
      }}
      t={t}
      locale={locale}
      onClose={closeBusiness}
      onLocation={(place) => {
        if (!place.location || business.location) return;
        setBusiness((b) =>
          b && b.key === business.key ? { ...b, location: place.location } : b,
        );
        canvas.current?.focusPoint(place.location);
      }}
    />
  );
  // Details share the one floating panel with results and layers (business wins when both exist).
  const detailInPanel = (!!selected || !!business) && !detailHidden;
  const routeInPanel = mvp && routeOpen;
  // The open place as a route stop: the keyboard and list path into a route.
  const openStop: PlannedStop | null = business
    ? business.location && !business.temporary
      ? {
          key: business.key,
          lat: business.location.lat,
          lng: business.location.lng,
          placeId: business.placeId,
          label:
            extraPoints.find((p) => p.key === business.key)?.label ||
            t.routeGooglePlace,
        }
      : null
    : selected
      ? itemStop(selected.key)
      : null;
  const inRoute = !!openStop && routeStops.some((s) => s.key === openStop.key);
  const routeAction = mvp && openStop && (
    <div className="route-action">
      <button
        type="button"
        className="button secondary small"
        aria-pressed={inRoute}
        onClick={() => toggleStop(openStop)}
      >
        <Route size={16} aria-hidden="true" />
        {inRoute ? t.routeRemoveThis : t.routeAdd}
      </button>
      {routeStops.length > 0 && (
        <button type="button" className="text-button" onClick={editRoute}>
          {t.routeEdit} ({routeStops.length})
        </button>
      )}
    </div>
  );
  // Every located place on the map, for "Route through these places".
  const routablePlaces = [
    ...mapped.map((i) => itemStop(i.key)),
    ...externalPoints.map(pointStop),
  ].filter((s): s is PlannedStop => !!s);
  const routeThrough = () => {
    const ordered = shortOrder(routablePlaces).slice(0, maxRouteStops);
    setRouteStops(ordered);
    setRouteNotice(
      routablePlaces.length > maxRouteStops
        ? format(t.routeThroughCapped, {
            max: maxRouteStops,
            total: routablePlaces.length,
          })
        : format(t.routeThroughDone, { count: ordered.length }),
    );
    editRoute();
  };
  const routeThroughButton = mvp && routablePlaces.length > 1 && (
    <button
      type="button"
      className="button secondary small route-through"
      onClick={routeThrough}
    >
      <Route size={16} aria-hidden="true" />
      {routeStops.length ? t.routeThroughReplace : t.routeThrough}
    </button>
  );
  // The route bar: present while there are stops, so no mode is needed.
  const barLinks = routeLinks(routeStops, travelMode);
  const routeBar = mvp && routeStops.length > 0 && (
    <div className="route-bar" role="group" aria-label={t.routeTitle}>
      <button
        type="button"
        className="route-bar-edit"
        aria-expanded={routeInPanel}
        aria-controls="map-panel"
        onClick={() => (routeInPanel ? setRouteOpen(false) : editRoute())}
      >
        <Route size={16} aria-hidden="true" />
        <span>
          {routeStops.length === 1
            ? t.routeBarOne
            : format(t.routeBar, { count: routeStops.length })}
        </span>
        <span className="route-bar-action">{t.routeEdit}</span>
      </button>
      {barLinks.length === 1 && (
        <a
          className="route-bar-open"
          aria-label={t.routeOpen}
          href={barLinks[0].url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            track("route_opened", {
              stops: routeStops.length,
              links: 1,
              mode: travelMode,
            })
          }
        >
          <ExternalLink size={16} aria-hidden="true" />
          <span>{t.routeOpen}</span>
        </a>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={t.routeClear}
        title={t.routeClear}
        onClick={() => {
          setRouteStops([]);
          setRouteOpen(false);
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
  /** Add or remove a hovered pin from the route, right on its hover card. */
  const tipRouteButton = (key: string) => {
    const stop = mvp ? stopFor(key) : null;
    if (!stop) return null;
    const added = routeStops.some((s) => s.key === key);
    return (
      <button
        type="button"
        className="button secondary small tip-route"
        aria-pressed={added}
        onClick={() => toggleStop(stop)}
      >
        <Route size={16} aria-hidden="true" />
        {added ? t.routeRemoveThis : t.routeAdd}
      </button>
    );
  };
  // Escape closes a pin tooltip. Menus, fields and an open detail keep the key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, details[open], [role=dialog]")
      )
        return;
      if (tip) setTip(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tip]);
  const layerCount = result.layers.filter((l) => l.status === "ok").length;
  // MVP layers are mostly Google places, counted once they have a location.
  const placeCount = announcedCount;
  const otherCity = result.layers.filter((l) => l.status === "other-city");
  const preview = selected && (
    <ItemPreview
      item={selected}
      detail={detail.key === selected.key ? detail.data : null}
      loading={detail.loading}
      error={detail.error}
      authenticated={authenticated}
      t={t}
      locale={locale}
      timeZone={city.timezone}
      citySlug={city.slug}
      onClose={closeDetail}
      onRefresh={() => {
        loadDetail(selected.key);
        // The Daily Pick card shows the same place's save state; re-query it too.
        if (result.dailyPick?.pick?.key === selected.key)
          setForce((n) => n + 1);
      }}
      layerWrites={layerWrites}
      backLabel={t.backToResults}
    />
  );
  const knownLayers = new Map(
    [...hiddenLayers, ...result.layers].map((l) => [l.slug, l]),
  );
  const panelLayers = shownSlugs
    .map((slug) => knownLayers.get(slug))
    .filter((l): l is LayerAvailability => !!l && l.status !== "other-city");
  const layersPanel = (
    <ActiveLayersPanel
      layers={panelLayers}
      library={mvp ? (library ?? []) : null}
      hidden={hiddenLayers.filter((h) => !shownSlugs.includes(h.slug))}
      t={t}
      locale={locale}
      refreshing={refreshing}
      onToggle={toggleLayer}
      onOnly={onlyLayer}
    />
  );
  const summary = (
    <div className="results-summary">
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
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      {result.searchScope === "city" && (
        <p className="fine-print">
          {format(t.searchOverlay, { city: city.name })}
        </p>
      )}
      {pendingArea && state.area && (
        <p className="fine-print">{t.previousArea}</p>
      )}
      {result.truncated && <p className="fine-print">{t.zoomIn}</p>}
      {loadError && (
        <p className="message error-message" role="alert">
          {loadError}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setForce((n) => n + 1)}
          >
            {t.retry}
          </button>
        </p>
      )}
    </div>
  );
  const emptyState =
    mvp && appliedSlugs.length === 0 ? (
      <div className="empty">
        <h3>{t.mvpEmptyTitle}</h3>
        <p>{authenticated ? t.mvpEmptyBody : t.signInForLayers}</p>
        <div className="actions">
          {authenticated ? (
            <>
              <button
                type="button"
                className="button secondary small"
                onClick={() => setTab("layers")}
              >
                {t.yourLayers}
              </button>
              <Link className="button small" href="/layers/new">
                {t.createFromGoogle}
              </Link>
            </>
          ) : (
            <Link className="button small" href="/sign-in?next=%2F">
              {t.signIn}
            </Link>
          )}
        </div>
      </div>
    ) : appliedSlugs.length === 0 && result.searchScope !== "city" ? (
      <div className="empty">
        <h3>{t.chooseLayer}</h3>
        <p>{t.chooseLayerBody}</p>
        <Link className="button" href="/layers">
          {t.findLayers}
        </Link>
      </div>
    ) : result.total === 0 && !mvp ? (
      // MVP layers are mostly Google places, listed below by ExternalReferences.
      <div className="empty">
        <h3>
          {state.area
            ? t.noResultsArea
            : state.date !== "upcoming"
              ? t.noResultsDate
              : t.empty}
        </h3>
        <div className="actions">
          {state.area && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => commit({ area: undefined })}
            >
              {t.clearArea}
            </button>
          )}
          {state.date !== "upcoming" && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => commit({ date: "upcoming" })}
            >
              {t.showUpcoming}
            </button>
          )}
          {(state.types?.length ?? 3) < itemTypes.length && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => commit({ types: [...itemTypes] })}
            >
              {t.typeAll}
            </button>
          )}
        </div>
      </div>
    ) : null;
  const dailyPick = result.dailyPick && (
    <DailyPickCard
      key={`${result.dailyPick.pick?.id ?? "none"}:${result.dailyPick.saved}`}
      view={result.dailyPick}
      cityName={city.name}
      citySlug={city.slug}
      providerKey={places.providerKey}
      t={t}
      locale={locale}
      authenticated={authenticated}
      onShow={select}
      onChanged={() => {
        // Authoritative refresh: the card's saved state and any open detail for the same place.
        setForce((n) => n + 1);
        const key = result.dailyPick?.pick?.key;
        if (key && detail.key === key) loadDetail(key);
      }}
      onShowToday={(key) => {
        // Explain-and-offer, never a silent substitute: clear only what hides the pick.
        commit({
          area: undefined,
          types: [...itemTypes],
          q: "",
          scope: "layers",
          item: key,
        });
        pushedSelection.current = true;
        setPendingArea(null);
        reveal();
        setSheet("half");
      }}
    />
  );
  const externalReferences = (
    <ExternalReferences
      provider={provider}
      queryKey={queryKey}
      area={state.area}
      selectedSubjectId={business?.subjectId ?? null}
      t={t}
      locale={locale}
      timeZone={city.timezone}
      events={result.events}
      autoLoad={mvp}
      onPending={setPendingExternal}
      onPoints={setExternalPoints}
      onSelect={(ref, location) =>
        selectBusiness({
          key: ref.canonicalKey,
          placeId: ref.providerPlaceId,
          subjectId: ref.subjectId,
          location,
          temporary: false,
        })
      }
    />
  );
  // Attached events at the selected place, shown above its details.
  const selectedEvents = result.events[business?.key ?? selectedKey ?? ""];
  const attachedEvents = selectedEvents?.length ? (
    <section className="attached-events" aria-labelledby="attached-events">
      <h3 id="attached-events">
        <CalendarDays size={16} aria-hidden="true" /> {t.upcomingEvents}
      </h3>
      <ul className="event-list">
        {selectedEvents.map((event) => (
          <li key={event.id}>
            <span className="event-when">
              {eventRange(event, locale, city.timezone)}
            </span>
            <b>{eventTitle(event, locale)}</b>
            {event.note && <span className="muted">{event.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  ) : null;
  const resultsPanel = (
    <>
      {dailyPick}
      {summary}
      {routeThroughButton}
      {emptyState ?? (
        <MapResults
          items={mapped}
          unmapped={unmapped}
          t={t}
          locale={locale}
          selectedKey={selectedKey}
          onSelect={select}
          limit={limit}
          onMore={() => setLimit((n) => n + 20)}
          onHover={setListHoverKey}
          events={result.events}
          timeZone={city.timezone}
        />
      )}
      {!mvp && externalReferences}
    </>
  );
  const discoveryPanel = provider && (
    <BusinessDiscovery
      provider={provider}
      cityCenter={{ lat: city.latitude, lng: city.longitude }}
      currentCenter={() => canvas.current?.getCenter() ?? null}
      t={t}
      onSelect={selectSearchPlace}
      onResults={(found) => {
        const points = found
          .filter((p) => p.location)
          .map((p) => ({
            key: `search:${p.id}`,
            kind: "search" as const,
            lat: p.location!.lat,
            lng: p.location!.lng,
            placeId: p.id,
          }));
        setSearchPoints(points);
        canvas.current?.fitPoints(points);
      }}
    />
  );
  const footer = (
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
  return (
    <div
      ref={root}
      className={`map-workspace ${listView ? "view-list" : "view-map"} sheet-${sheet} ${visible ? "has-panel" : "panel-closed"} ${fallback ? "map-fallback" : ""} ${detailInPanel ? "has-detail" : ""}`}
      data-canvas={canvasStatus}
      data-map-theme={theme}
      data-panel={visible ? "open" : "closed"}
      style={
        {
          // The panel starts under the measured search cluster and clears the dock.
          "--th-map-top": `${topInset + 12}px`,
          // Provider attribution clears a phone sheet at its real height.
          "--th-sheet-height": `${Math.round(visible ? panelHeight : 0)}px`,
          ...markerCssVars(theme),
        } as CSSProperties
      }
    >
      <h1 className="sr-only">
        {city.name} · {t.mapNav}
      </h1>
      <div className="map-stage">
        {/* The MVP map has no search or filters: it shows the loaded layers. */}
        {!mvp && (
          <MapToolbar
            state={state}
            cityName={city.name}
            t={t}
            contentEnabled={contentEnabled}
            onCommit={(patch) => {
              commit(patch);
              // A submitted search shows its results in the panel.
              if (patch.q) {
                setTab("results");
                setDetailHidden(true);
                setPanelOpen(true);
              }
            }}
          />
        )}
        {actionsTarget &&
          createPortal(
            <button
              type="button"
              className="map-float-button"
              aria-expanded={visible && !detailInPanel && tab === "layers"}
              aria-controls="map-panel"
              onClick={showLayers}
            >
              <LayersIcon size={20} aria-hidden="true" />
              <span>{t.layersTab}</span>
              <span className="count-pill">{layerCount}</span>
            </button>,
            actionsTarget,
          )}
        <div className="map-stage-body" hidden={listView} ref={stageBody}>
          {token && canvasStatus !== "failed" ? (
            <MapCanvas
              ref={canvas}
              token={token}
              items={result.items}
              selectedKey={business ? null : selectedKey}
              extraPoints={extraPoints}
              route={routeLine}
              extraSelectedKey={business?.key ?? null}
              effects={places.mapEffects}
              onSelectExtra={onSelectExtra}
              center={[city.longitude, city.latitude]}
              zoom={cityZoom}
              locale={locale}
              theme={theme}
              t={t}
              padding={padding}
              highlightKey={listHoverKey}
              onItemHover={onItemHover}
              onSelect={(key) => {
                if (!key) return;
                pickedOnMap.current = key;
                select(key);
              }}
              onUserMove={onUserMove}
              onStatus={onStatus}
              onLocationDenied={() => setLocationNote(t.locationDenied)}
            />
          ) : (
            <div className="map-unavailable" role="note">
              <p>{token ? t.mapUnavailableBody : t.mapNeedsToken}</p>
              <p className="fine-print">{t.mapUnavailable}</p>
              {token && (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => {
                    setCanvasStatus("loading");
                    window.setTimeout(() => canvas.current?.retry(), 0);
                  }}
                >
                  {t.retry}
                </button>
              )}
              <button
                type="button"
                className="button small"
                onClick={() => setView("list")}
              >
                <List size={16} aria-hidden="true" /> {t.listView}
              </button>
            </div>
          )}
          {canvasStatus === "loading" && token && (
            <div className="map-skeleton" aria-hidden="true">
              <span>{t.mapLoading}</span>
            </div>
          )}
          {canvasStatus === "ready" && (
            <div className="map-side-stack">
              <MarkerLegend t={t} kinds={mvp ? googleMarkerKinds : undefined} />
            </div>
          )}
          {tip &&
            (() => {
              // A card with a button is no longer a plain tooltip.
              const routeButton = tipRouteButton(tip.key);
              const role = routeButton ? undefined : "tooltip";
              // A Google place shows its own card: name, photo, rating, type.
              const point = extraPoints.find((p) => p.key === tip.key);
              if (point?.placeId && provider)
                return (
                  <div
                    className="map-tooltip map-place-tip"
                    role={point.tabelog ? undefined : role}
                    style={{
                      left: tip.x,
                      top: tip.y,
                      width: placeTipWidth,
                      transform: tip.above ? "translateY(-100%)" : undefined,
                    }}
                    onMouseEnter={() => window.clearTimeout(tipTimer.current)}
                    onMouseLeave={() => setTip(null)}
                  >
                    <ProviderDetails
                      key={point.placeId}
                      provider={provider}
                      placeId={point.placeId}
                      compact
                      preview
                      onLoad={() => {}}
                      onError={() => setTip(null)}
                    />
                    {point.tabelog && (
                      <TabelogLink
                        name={point.tabelog.name}
                        href={point.tabelog.url}
                        t={t}
                        className="tip-tabelog"
                      />
                    )}
                    {routeButton}
                  </div>
                );
              const item = result.items.find((i) => i.key === tip.key);
              if (!item) return null;
              const kind = markerKind(item);
              return (
                <div
                  className="map-tooltip"
                  role={tabelogLink(item) ? undefined : role}
                  style={{
                    left: tip.x,
                    top: tip.y,
                  }}
                  onMouseEnter={() => window.clearTimeout(tipTimer.current)}
                  onMouseLeave={() => setTip(null)}
                >
                  <strong>{localizedName(item, locale)}</strong>
                  <span>
                    <i
                      className="kind-dot"
                      style={{ background: `var(--marker-${kind})` }}
                      aria-hidden="true"
                    />
                    {markerLabel(kind, t)}
                    {item.category ? ` · ${item.category}` : ""}
                  </span>
                  <TabelogLink
                    name={item.name}
                    href={tabelogLink(item)}
                    t={t}
                    className="tip-tabelog"
                  />
                  {routeButton}
                </div>
              );
            })()}
          <div className="map-overlays">
            {pendingArea && (
              <button
                type="button"
                className="button search-area"
                onClick={searchArea}
              >
                {t.searchThisArea}
              </button>
            )}
            {newDay && (
              <div className="map-chip" role="status">
                {t.newDayAvailable}{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setForce((n) => n + 1)}
                >
                  {t.refresh}
                </button>
              </div>
            )}
            {locationNote && (
              <div className="map-chip" role="status">
                {locationNote}{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setLocationNote(null)}
                >
                  {t.close}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="map-dock">
          {!listView && !fallback && (
            <button
              ref={launcher}
              type="button"
              className="map-float-button map-list-toggle"
              aria-expanded={panelOpen}
              aria-controls="map-panel"
              onClick={() => togglePanel(!panelOpen)}
            >
              <List size={18} aria-hidden="true" />
              <span>
                {panelOpen
                  ? t.hideList
                  : format(t.showList, { count: placeCount })}
              </span>
            </button>
          )}
          {!listView && canvasStatus === "ready" && (
            <button
              type="button"
              className="map-float-button map-fit"
              onClick={() => canvas.current?.fitTo(result.items)}
              disabled={mapped.length === 0}
            >
              <Crosshair size={16} aria-hidden="true" />
              <span>{t.fitResults}</span>
            </button>
          )}
          {!listView && canvasStatus === "ready" && routeBar}
          {mvp && !routeInPanel && (
            <span className="sr-only" role="status">
              {routeNotice}
            </span>
          )}
          {state.area && !listView && (
            <button
              type="button"
              className="map-float-button"
              onClick={() => commit({ area: undefined })}
            >
              <X size={16} aria-hidden="true" />
              <span>{t.clearArea}</span>
            </button>
          )}
          {!listView ? (
            <button
              type="button"
              className="map-float-button"
              onClick={() => setView("list")}
            >
              <List size={16} aria-hidden="true" />
              <span>{t.listView}</span>
            </button>
          ) : (
            <button
              type="button"
              className="map-float-button"
              onClick={() => setView("map")}
            >
              <MapIcon size={16} aria-hidden="true" />
              <span>{t.mapView}</span>
            </button>
          )}
          {hasDemo && !visible && (
            <span className="map-demo-chip">{t.demoNotice}</span>
          )}
        </div>
      </div>
      <div
        id="map-panel"
        className="map-panel"
        ref={panelRef}
        role="region"
        aria-label={t.mapNav}
        tabIndex={-1}
        hidden={!visible}
        onScroll={(event) => {
          if (!detailInPanel)
            savedScroll.current = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          // Escape closes the panel unless a field or open menu owns the key.
          if (event.key !== "Escape" || event.defaultPrevented) return;
          const target = event.target as HTMLElement;
          if (target.closest("input, textarea, select, details[open]")) return;
          if (listView || fallback) return;
          event.preventDefault();
          togglePanel(false);
        }}
      >
        <div id="map-sidebar-content" className="map-sidebar-content">
          <div className="sheet-handle">
            <span className="sheet-buttons">
              <button
                type="button"
                className="icon-button"
                aria-label={t.shrinkPanel}
                disabled={sheet === "half"}
                onClick={() => setSheet("half")}
              >
                <ChevronDown size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t.expand}
                disabled={sheet === "expanded"}
                onClick={() => setSheet("expanded")}
              >
                <ChevronUp size={18} aria-hidden="true" />
              </button>
            </span>
            {!listView && !fallback && (
              <button
                type="button"
                className="icon-button"
                aria-label={t.hideList}
                title={t.hideList}
                onClick={() => togglePanel(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          {provider && !mvp && (
            <div
              className="segmented discovery-modes"
              role="group"
              aria-label={t.discoveryModes}
            >
              {(
                [
                  ["layers", t.layersMode],
                  ["business", t.businessMode],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  className={mode === value ? "on" : ""}
                  onClick={() => {
                    setMode(value);
                    setTab("results");
                    setDetailHidden(true);
                    // Leaving discovery clears temporary pins but keeps layer pins and selection.
                    if (value === "layers") {
                      setSearchPoints([]);
                      if (business?.temporary) setBusiness(null);
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {otherCity.map((l) => (
            <p key={l.slug} className="fine-print">
              {format(t.layerOtherCity, { city: l.cityName ?? "" })}
            </p>
          ))}
          {routeInPanel ? (
            <div className="panel-body">
              <RoutePlanner
                stops={routeStops}
                mode={travelMode}
                notice={routeNotice}
                t={t}
                onMode={setTravelMode}
                onChange={setRouteStops}
                onDone={() => setRouteOpen(false)}
              />
            </div>
          ) : detailInPanel ? (
            <>
              {routeAction}
              {attachedEvents}
              {businessPanel ?? preview}
            </>
          ) : mode === "business" && discoveryPanel && !mvp ? (
            <div className="panel-body">{discoveryPanel}</div>
          ) : (
            <>
              <div className="panel-tabs" role="tablist" aria-label={t.mapNav}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "layers"}
                  onClick={() => setTab("layers")}
                >
                  {t.layersTab} <span className="count-pill">{layerCount}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "results"}
                  onClick={() => setTab("results")}
                >
                  {t.resultsTab}{" "}
                  <span className="count-pill">{placeCount}</span>
                </button>
              </div>
              <div className="panel-body" role="tabpanel">
                {tab === "layers" ? layersPanel : resultsPanel}
              </div>
            </>
          )}
          {mvp && (
            // Google place pins come from these rows, so they stay mounted
            // (hidden) whichever view the panel shows.
            <div
              className="panel-body mvp-places"
              hidden={routeInPanel || detailInPanel || tab !== "results"}
            >
              {externalReferences}
            </div>
          )}
          {footer}
        </div>
      </div>
    </div>
  );
}
