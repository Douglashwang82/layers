"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { LayerWorkspaceContext } from "../layers/workspace-navigation";
import { TripsEntry, useTripScreen } from "../trips/trip-screen";
import type { TripScreenData } from "@/features/trips/screen";
import { orderLayers } from "@/lib/layer-labels";
import {
  readTripPanel,
  tripPanelKeys,
  withoutTripPanel,
} from "@/lib/trip-panel";
import {
  layerPanelKeys,
  readLayerPanel,
  withoutLayerPanel,
} from "@/lib/layer-workspace";
import {
  accountPanelKey,
  readAccountPanel,
  withoutAccountPanel,
} from "@/lib/account-panel";
import {
  ExternalLink,
  Layers as LayersIcon,
  Crosshair,
  Route,
  X,
} from "lucide-react";
import {
  itemTypes,
  localDate,
  parseMapQuery,
  serializeMapQuery,
  type Bounds,
  type MapState,
  appliedSlots,
  maxAppliedCollections,
  maxAppliedLayers,
} from "@taiwanhub/shared";
import type { CollectionNode } from "@/features/layers/collections-types";
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
import { getPlacesProvider } from "@/lib/places/provider";
import { BusinessPanel } from "@/components/places/business-panel";
import { useExternalReferences } from "@/components/places/use-external-references";
import {
  markerCssVars,
  markerKind,
  markerLabel,
} from "@/lib/marker-presentation";
import { useMapTheme } from "@/lib/map-theme";
import { ActiveLayersPanel } from "./active-layers-panel";
import { TabelogLink } from "./map-results";
import { tabelogLink } from "@/lib/tabelog";
import { ItemPreview } from "./item-preview";
import { MapSidebar, type PanelBack } from "./map-sidebar";
import {
  AttachedEvents,
  MapEmptyState,
  SidebarFooter,
} from "./map-sidebar-sections";
import { PlaceAttachments } from "./place-attachments";
import { LayerSuggestions } from "./layer-suggestions";
import {
  TipReviews,
  tipReviewsHeight,
  tipReviewsWidth,
  useMapReviewPreviews,
} from "./tip-reviews";
import { RoutePlanner, type PlannedStop } from "./route-planner";
import {
  maxRouteStops,
  routeLinks,
  shortOrder,
  type TravelMode,
} from "@/lib/route-link";
import { DailyPickCard } from "@/components/daily-pick/daily-pick-card";
import { track } from "@/lib/track";
import { mapSessionKey } from "@/lib/map-session";
import {
  initialPanelOpen,
  mapPadding,
  panelStorageKey,
  panelVisible,
  resolvePanelView,
  storedPanelOpen,
  type PanelView,
} from "@/lib/map-panel";
const noItems: MapQueryResult["items"] = [];
const noExtraPoints: ExtraPoint[] = [];
/** Mobile sheet height; the sheet is closed when the panel is not open. */
type Sheet = "half" | "expanded";
/** Camera zoom showing a whole city, at start and after switching cities. */
const cityZoom = 10.5;
/** Wait for the panel and padding to settle before moving the camera. */
const afterLayout = (run: () => void) => window.setTimeout(run, 80);
/** The Google place hover card's size (height approximate: photo, card, Tabelog link), for keeping it inside the map. */
const placeTipWidth = 280;
const placeTipHeight = 400;
/** Server-read flags and the browser-visible provider key. */
export type PlacesConfig = {
  providerKey: string | null;
  reviewWrites: boolean;
  collections: boolean;
  mapEffects: boolean;
};
/** An in-memory business selection; it never enters the URL until a subject exists. */
type BusinessSelection = {
  key: string;
  placeId: string | null;
  subjectId: string | null;
  location: { lat: number; lng: number } | null;
  temporary: boolean;
  name?: string | null;
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
  layerWrites,
  places,
  library = null,
  folders = [],
  layerScreen,
  accountScreen = null,
  tripsEnabled = false,
  layerSuggestionsEnabled = false,
  tripData = null,
}: {
  initial: MapQueryResult;
  initialDetail: ItemDetail | null;
  city: MapCity;
  t: Copy;
  locale: Locale;
  authenticated: boolean;
  token: string | undefined;
  hasDemo: boolean;
  layerWrites: boolean;
  places: PlacesConfig;
  /** Map MVP: the signed-in member's loadable layers. */
  library?: LayerAvailability[] | null;
  /** The signed-in member's top-level folders with their trees. */
  folders?: CollectionNode[];
  layerScreen?: ReactNode;
  /** The server-rendered account sidebar body; null unless `?account` is in the URL. */
  accountScreen?: ReactNode;
  /** FEATURE_TRIPS: without it trip params are ignored and no trip UI shows. */
  tripsEnabled?: boolean;
  /** FEATURE_LAYER_SUGGESTIONS: without it the suggestions section never renders or fetches. */
  layerSuggestionsEnabled?: boolean;
  /** The server-resolved trip screen for the URL (see features/trips/screen.ts). */
  tripData?: TripScreenData | null;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const layerPanel = readLayerPanel(new URLSearchParams(searchParams));
  const tripPanel = tripsEnabled
    ? readTripPanel(new URLSearchParams(searchParams))
    : null;
  /** The URL's query without layer or trip screens: the plain map state. */
  const bareSearch = () =>
    withoutTripPanel(
      withoutLayerPanel(searchParams.toString()).split("?")[1] ?? "",
    ).split("?")[1] ?? "";
  const bareHref = () => {
    const query = bareSearch();
    return "/" + (query ? "?" + query : "");
  };
  const accountOpen = readAccountPanel(new URLSearchParams(searchParams));
  const layerScreenKey = layerPanelKeys
    .map((key) => searchParams.get(key) ?? "")
    .join("|");
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
      // An explicit layer selection without folders means "no folders" (empty
      // collections are omitted from the URL), not the server-rendered ones.
      collections:
        parsed.collections ??
        (parsed.layers !== undefined ? [] : (initial.state.collections ?? [])),
    };
  }, [
    searchParams,
    city.slug,
    initial.state.layers,
    initial.state.collections,
  ]);
  const queryKey = keyOf(state, true);
  // Declared early: effects below open the panel when a selection arrives.
  const [panelOpen, setPanelOpen] = useState(() =>
    initialPanelOpen({
      hasItem: !!state.item || !!layerPanel || !!tripPanel,
      fallback: !token,
    }),
  );
  /* Results: keep the previous dataset usable during refresh; ignore stale responses. */
  const [result, setResult] = useState(initial);
  const resultKey = useRef(keyOf(initial.state, true));
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [force, setForce] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setForce((value) => value + 1);
        router.refresh();
      }, 150);
    };
    window.addEventListener("layer:changed", changed);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("layer:changed", changed);
    };
  }, [router]);
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
      // Old links can still say view=list; the map is the only view now.
      const next = { ...state, ...patch, view: "map" as const };
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
      const params = new URLSearchParams(qs);
      for (const key of [
        ...layerPanelKeys,
        ...tripPanelKeys,
        accountPanelKey,
      ]) {
        const value = searchParams.get(key);
        if (value !== null) params.set(key, value);
      }
      window.history[mode === "push" ? "pushState" : "replaceState"](
        null,
        "",
        "/?" + params.toString(),
      );
    },
    [state, hasExplicitCity, searchParams],
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
  const appliedFolders = state.collections ?? [];
  const [optimisticFolders, setOptimisticFolders] = useState<string[] | null>(
    null,
  );
  useEffect(() => {
    setOptimisticFolders(null);
  }, [state.collections]);
  const shownFolders = optimisticFolders ?? appliedFolders;
  // Layers and folders share the map's slots; empty states look at both.
  const slotsUsed = appliedSlots(shownSlugs, shownFolders);
  const hasApplied = appliedSlugs.length + appliedFolders.length > 0;
  const persist = useCallback(
    (layers: string[], collections: string[], view: MapState["view"]) => {
      if (!authenticated) return;
      // keepalive so a quick navigation away never loses the preference.
      fetch("/api/v1/map/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layers, collections, view }),
        keepalive: true,
      }).catch(() => {});
    },
    [authenticated],
  );
  // Ticking a layer or folder changes what is shown, never where the user is looking.
  const holdCamera = useRef(false);
  const toggleLayer = (slug: string, applied: boolean, frame = false) => {
    if (applied && shownSlugs.includes(slug)) return;
    if (applied && slotsUsed >= maxAppliedLayers) {
      setLoadError(format(t.layerLimit, { max: maxAppliedLayers }));
      return;
    }
    const next = applied
      ? [...shownSlugs, slug]
      : shownSlugs.filter((s) => s !== slug);
    const entry = result.layers.find((l) => l.slug === slug);
    // Kept while re-applied: the row needs its data until the new results land.
    if (!applied && entry)
      setHiddenLayers((h) => [...h.filter((x) => x.slug !== slug), entry]);
    holdCamera.current = !frame;
    setOptimisticLayers(next);
    commit({ layers: next.length ? next : "none" });
    track(applied ? "layer_applied" : "layer_hidden", { layer: slug });
  };
  const toggleFolder = (slug: string, applied: boolean) => {
    if (applied && shownFolders.includes(slug)) return;
    if (applied && slotsUsed >= maxAppliedLayers) {
      setLoadError(format(t.layerLimit, { max: maxAppliedLayers }));
      return;
    }
    if (applied && shownFolders.length >= maxAppliedCollections) {
      setLoadError(
        format(t.folderLimitFolders, { max: maxAppliedCollections }),
      );
      return;
    }
    const next = applied
      ? [...shownFolders, slug]
      : shownFolders.filter((s) => s !== slug);
    holdCamera.current = true;
    setOptimisticFolders(next);
    commit({ collections: next });
  };
  // Whatever is applied, by toggle or by explicit link, becomes the returning user's default.
  const appliedKey = [...appliedSlugs, "|", ...appliedFolders].join(",");
  const layersKey = appliedSlugs.join(",");
  const foldersKey = appliedFolders.join(",");
  useEffect(() => {
    persist(
      layersKey ? layersKey.split(",") : [],
      foldersKey ? foldersKey.split(",") : [],
      "map",
    );
  }, [layersKey, foldersKey, persist]);
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
    // Picking a place shows it: the planner keeps its stops and reopens from the bar.
    setRouteOpen(false);
    setPanelOpen(true);
  };
  const select = (key: string) => {
    if (
      layerPanel &&
      !window.dispatchEvent(
        new Event("layer:before-leave", { cancelable: true }),
      )
    )
      return;
    reveal();
    setBusiness(null);
    if (layerPanel || tripPanel) {
      const params = new URLSearchParams(bareSearch());
      params.set("item", key);
      router.push("/?" + params, { scroll: false });
    } else commit({ item: key }, "push");
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
  const [tip, setTip] = useState<{
    key: string;
    /** Pointer x and the stage width, so the left edge can follow a late review column. */
    pointerX: number;
    stageWidth: number;
    /** Card width without the review column. */
    width: number;
    y: number;
    above?: boolean;
  } | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  const { previews: reviewPreviews, request: requestReviewPreviews } =
    useMapReviewPreviews(queryKey);
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  const stageBody = useRef<HTMLDivElement>(null);
  /* Google place selection is in memory, lazily loading the provider. */
  const provider = useMemo(
    () => getPlacesProvider(places.providerKey ?? undefined, locale),
    [places.providerKey, locale],
  );
  const [business, setBusiness] = useState<BusinessSelection | null>(null);
  const [locatedPlaces, setLocatedPlaces] = useState<
    Record<string, { lat: number; lng: number }>
  >({});
  const external = useExternalReferences({
    queryKey,
    locatedPlaces,
    area: state.area,
    reload: force,
  });
  const externalPoints = external.points;
  const extraPoints = useMemo(() => {
    const points = [...externalPoints];
    if (business?.location && !points.some((p) => p.key === business.key))
      points.push({
        key: business.key,
        kind: business.temporary ? "search" : "external",
        lat: business.location.lat,
        lng: business.location.lng,
        placeId: business.placeId ?? undefined,
      });
    return points;
  }, [externalPoints, business]);
  const onItemHover = (hover: { key: string; x: number; y: number } | null) => {
    window.clearTimeout(tipTimer.current);
    if (hover) {
      requestReviewPreviews();
      // Keep the tooltip inside the map: clamp against the stage size at event
      // time. A Google place card is wider and taller, and flips above the
      // pointer near the bottom edge.
      const stage = stageBody.current;
      const width = stage?.clientWidth ?? 1024;
      const height = stage?.clientHeight ?? 768;
      const card = extraPoints.some((p) => p.key === hover.key && p.placeId);
      // A review list beside the card can be taller than the card itself.
      const [w, h] = [
        card ? placeTipWidth : 234,
        Math.max(
          card ? placeTipHeight : 0,
          tipReviewsHeight(reviewPreviews[hover.key]),
        ),
      ];
      const above = hover.y + 14 + h > height && hover.y - 14 - h > 0;
      setTip({
        key: hover.key,
        pointerX: hover.x,
        stageWidth: width,
        width: w,
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
    if (layerPanel) {
      if (
        !window.dispatchEvent(
          new Event("layer:before-leave", { cancelable: true }),
        )
      )
        return;
      router.push(withoutLayerPanel(searchParams.toString()), {
        scroll: false,
      });
    }
    if (tripPanel && !layerPanel) router.push(bareHref(), { scroll: false });
    reveal();
    setBusiness(next);
    setSheet("half");
    const spot = next.location;
    if (spot && moveCamera) afterLayout(() => canvas.current?.focusPoint(spot));
  };
  const closeBusiness = () => {
    setBusiness(null);
    focusPanel();
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
        name: point.label,
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
      appliedFolders.length === 0 &&
      result.layers[0]?.ownerKind !== "system"
    )
      canvas.current?.fitTo(result.items);
  }, [
    canvasStatus,
    state.area,
    appliedSlugs.length,
    appliedFolders.length,
    result,
  ]);
  const searchArea = () => {
    if (!pendingArea) return;
    commit({ area: pendingArea });
    setPendingArea(null);
    track("map_area_searched", {});
  };
  /*
   * Framing: every loaded place (catalog/custom pins and Google places as
   * they resolve) stays in view until the user moves the map themselves; a
   * new set of layers from a link, or a chosen starter, starts framing again.
   * Ticks and Add to map do not: the camera stays put and Fit results is there.
   */
  const autoFit = useRef<string | null>(null);
  const onUserMove = () => {
    autoFit.current = null;
  };
  /* Layout: everything floats over one full-viewport map; the list is a collapsible panel. */
  const mobile = useMedia("(max-width: 800px)");
  // Without a token or after a provider failure the list is the product and cannot be hidden.
  const fallback = !token || canvasStatus === "failed";
  const visible =
    !!layerPanel || !!tripPanel || panelVisible({ open: panelOpen, fallback });
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Focus lands on the scrolling area, so the keyboard scrolls the panel. */
  const focusPanel = () => scrollRef.current?.focus();
  // Shared item links and fallback win over the remembered preference.
  useEffect(() => {
    const forced = !!state.item || !token;
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
  const tripScreen = useTripScreen({
    data: tripData,
    panel: tripPanel,
    locale,
    canvas,
    canvasReady: canvasStatus === "ready",
    mapShown: !!token && canvasStatus !== "failed",
  });
  // An open trip owns the map: layer pins, Google places and the route line
  // step aside (their state is kept) and return when the trip is left.
  const tripDrawn = !!tripScreen?.geo;
  const launcher = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tripScreenKey = tripScreen?.screenKey;
  useEffect(() => {
    if (!tripScreenKey) return;
    scrollRef.current?.focus();
    scrollRef.current?.scrollTo(0, 0);
  }, [tripScreenKey]);
  useEffect(() => {
    if (!layerPanel) return;
    scrollRef.current?.focus();
    scrollRef.current?.scrollTo(0, 0);
  }, [layerScreenKey, layerPanel]);
  const togglePanel = (open: boolean) => {
    if (!open && (layerPanel || tripPanel)) {
      if (
        layerPanel &&
        !window.dispatchEvent(
          new Event("layer:before-leave", { cancelable: true }),
        )
      )
        return;
      router.push(bareHref(), { scroll: false });
    }
    setPanelOpen(open);
    if (!mobile)
      try {
        localStorage.setItem(panelStorageKey, String(!open));
      } catch {
        /* Keep the in-memory preference. */
      }
    // Focus follows the control the user just used; hidden content leaves the tab order.
    window.requestAnimationFrame(() =>
      (open ? scrollRef.current : launcher.current)?.focus(),
    );
  };
  const [sheet, setSheet] = useState<Sheet>("half");
  const detailInPanel =
    !layerPanel && (!!selected || !!business) && !detailHidden;
  const view = resolvePanelView({
    tripScreen: !!tripScreen,
    layerScreen: !!layerPanel,
    routeOpen,
    detailOpen: detailInPanel,
  });
  const routeInPanel = view === "route";
  // Details open at the top and return to where the list was; other screens start at the top.
  const savedScroll = useRef(0);
  const scrolledView = useRef<PanelView>(view);
  const openPlaceKey = business?.key ?? selectedKey;
  useEffect(() => {
    const node = scrollRef.current;
    const from = scrolledView.current;
    scrolledView.current = view;
    if (!node || (from === view && view !== "detail")) return;
    node.scrollTop =
      from === "detail" && view === "layers" ? savedScroll.current : 0;
  }, [view, openPlaceKey]);
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
  // The account sidebar floats on the right; the camera clears its left edge.
  const accountRef = useRef<HTMLElement>(null);
  const [accountInset, setAccountInset] = useState(0);
  useEffect(() => {
    const node = accountRef.current;
    if (!accountOpen || !node) {
      setAccountInset(0);
      return;
    }
    const measure = () => {
      const stage = root.current?.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      setAccountInset(
        Math.max(0, Math.round((stage?.right ?? window.innerWidth) - box.left)),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [accountOpen]);
  // Opening the sidebar moves focus to its heading; closing returns it to the menu.
  const accountHeading = useRef<HTMLHeadingElement>(null);
  const wasAccountOpen = useRef(accountOpen);
  useEffect(() => {
    if (accountOpen && !wasAccountOpen.current) accountHeading.current?.focus();
    // Only when focus went down with the sidebar: a navigation that opened
    // another screen has already placed focus there.
    if (
      !accountOpen &&
      wasAccountOpen.current &&
      (!document.activeElement || document.activeElement === document.body)
    )
      document.querySelector<HTMLElement>(".map-profile-menu summary")?.focus();
    wasAccountOpen.current = accountOpen;
  }, [accountOpen]);
  const closeAccount = () =>
    router.push(withoutAccountPanel(searchParams.toString()), {
      scroll: false,
    });
  // On phones the account sheet covers the panel: a layer or trip screen
  // opened while it is up (bottom nav, a sidebar row) closes the sheet.
  const leftScreenKey = `${layerScreenKey}|${tripPanel ? JSON.stringify(tripPanel) : ""}`;
  const shownLeftScreen = useRef(leftScreenKey);
  useEffect(() => {
    const changed = shownLeftScreen.current !== leftScreenKey;
    shownLeftScreen.current = leftScreenKey;
    if (!changed || !mobile || !accountOpen || (!layerPanel && !tripPanel))
      return;
    router.replace(withoutAccountPanel(window.location.search), {
      scroll: false,
    });
  }, [leftScreenKey, mobile, accountOpen, layerPanel, tripPanel, router]);
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
        visible,
        panelRight,
        rightPanelInset: accountInset,
        panelHeight,
        topInset,
        // Floating navigation and the list entry sit at the bottom of a phone.
        bottomInset: visible ? 76 : 128,
        viewportHeight,
      }),
    [
      mobile,
      visible,
      panelRight,
      accountInset,
      panelHeight,
      topInset,
      viewportHeight,
    ],
  );
  useEffect(() => {
    canvas.current?.resize();
  }, [sheet, visible, mobile]);
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
    if (layerPanel || tripPanel) {
      if (
        layerPanel &&
        !window.dispatchEvent(
          new Event("layer:before-leave", { cancelable: true }),
        )
      )
        return;
      router.push(bareHref(), { scroll: false });
    }
    setDetailHidden(true);
    setRouteOpen(false);
    setPanelOpen(true);
    window.requestAnimationFrame(focusPanel);
  };
  const editRoute = () => {
    setRouteOpen(true);
    setPanelOpen(true);
    setSheet("half");
    setTip(null);
    window.requestAnimationFrame(focusPanel);
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
  // Counts include Google places as they get a location.
  const announcedCount = result.total + externalPoints.length;
  useEffect(() => {
    setAnnounce(format(t.resultsInArea, { count: announcedCount }));
  }, [announcedCount, result.generatedAt, t.resultsInArea]);
  const mapped = result.items.filter(
    (i) => i.latitude != null && i.longitude != null,
  );
  useEffect(() => {
    autoFit.current = holdCamera.current ? null : appliedKey;
    holdCamera.current = false;
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
    if (canvasStatus !== "ready" || autoFit.current !== appliedKey) return;
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
  }, [canvasStatus, appliedKey, result, externalPoints]);
  const businessPanel = business && (
    <BusinessPanel
      key={business.key}
      provider={provider}
      placeId={business.placeId}
      name={business.name}
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
      onLocation={(place) => {
        if (!place.location) return;
        const location = place.location;
        setLocatedPlaces((current) => ({ ...current, [place.id]: location }));
        if (business.location) return;
        setBusiness((b) =>
          b && b.key === business.key ? { ...b, location: place.location } : b,
        );
        canvas.current?.focusPoint(place.location);
      }}
    />
  );
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
  const routeAction = openStop && (
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
  const routeThroughButton = routablePlaces.length > 1 && (
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
  const routeBar = routeStops.length > 0 && (
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
    const stop = stopFor(key);
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
  // Applied folders count too: each takes a map slot like a layer.
  const layerCount =
    result.layers.filter((l) => l.status === "ok").length +
    (result.collections ?? []).filter((c) => c.status === "ok").length;
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
      onRefresh={() => {
        loadDetail(selected.key);
        // The Daily Pick card shows the same place's save state; re-query it too.
        if (result.dailyPick?.pick?.key === selected.key)
          setForce((n) => n + 1);
      }}
      layerWrites={layerWrites}
      provider={provider}
    />
  );
  const knownLayers = new Map(
    [...hiddenLayers, ...result.layers].map((l) => [l.slug, l]),
  );
  const panelLayers = orderLayers(
    shownSlugs
      .map((slug) => knownLayers.get(slug))
      .filter((l): l is LayerAvailability => !!l),
    library ?? [],
  );
  const layersPanel = (
    <ActiveLayersPanel
      layers={panelLayers}
      shownSlugs={shownSlugs}
      library={library ?? []}
      folders={folders}
      appliedFolders={shownFolders}
      onToggleFolder={toggleFolder}
      hidden={hiddenLayers.filter((h) => !shownSlugs.includes(h.slug))}
      t={t}
      locale={locale}
      refreshing={refreshing}
      onToggle={toggleLayer}
    />
  );
  // First run: a signed-in member with no layers of their own.
  const firstRun =
    authenticated &&
    library != null &&
    !library.some((l) => l.ownerKind !== "system");
  const suggestions = (
    <LayerSuggestions
      queryKey={queryKey}
      enabled={
        layerSuggestionsEnabled &&
        authenticated &&
        hasApplied &&
        !firstRun &&
        visible
      }
      t={t}
      locale={locale}
    />
  );
  // A signed-in member has the Layers list to act from.
  const emptyState = !hasApplied && !authenticated && <MapEmptyState t={t} />;
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
      addToLayer={layerWrites}
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
  // Attached events at the selected place, shown with its details.
  const selectedEvents = result.events[business?.key ?? selectedKey ?? ""];
  // Add events and tips to the selected place right here, per layer holding it.
  const attachKey = business?.key ?? selected?.key ?? null;
  const attachments =
    authenticated && attachKey && !business?.temporary ? (
      <PlaceAttachments
        key={`attach:${attachKey}`}
        placeKey={attachKey}
        placeName={
          business
            ? (business.name ?? t.routeGooglePlace)
            : selected
              ? localizedName(selected, locale)
              : ""
        }
        layers={panelLayers}
        events={selectedEvents ?? []}
        city={city}
        layerWrites={layerWrites}
        tips={!business}
        t={t}
        locale={locale}
        onEventsChanged={() => setForce((n) => n + 1)}
      />
    ) : null;
  /** Each screen's header and body; the shell around them never changes. */
  const screen: {
    title?: string;
    count?: number;
    back?: PanelBack;
    body: ReactNode;
  } = (() => {
    switch (view) {
      case "trip-screen":
        return tripScreen!;
      case "layer-screen":
        return {
          back: { label: t.mapEntry, href: "/" },
          body: (
            <div
              className="panel-body layer-workspace-screen"
              key={layerScreenKey}
            >
              {layerScreen}
            </div>
          ),
        };
      case "route":
        return {
          title: t.routeTitle,
          back: { label: t.close, onClick: () => setRouteOpen(false) },
          body: (
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
          ),
        };
      case "detail":
        return {
          back: {
            label: t.backToLayers,
            onClick: business ? closeBusiness : closeDetail,
          },
          body: (
            <>
              {routeAction}
              {businessPanel ?? preview}
              <AttachedEvents
                events={selectedEvents}
                locale={locale}
                timeZone={city.timezone}
                t={t}
              />
              {attachments}
            </>
          ),
        };
      case "layers":
        return {
          title: t.yourLayers,
          count: slotsUsed,
          body: (
            <div className="panel-body">
              {emptyState}
              {dailyPick}
              {suggestions}
              {routeThroughButton}
              {external.error && (
                <p className="message error-message" role="alert">
                  {t.error}{" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={external.retry}
                  >
                    {t.retry}
                  </button>
                </p>
              )}
              {layersPanel}
            </div>
          ),
        };
    }
  })();
  return (
    <LayerWorkspaceContext.Provider
      value={{
        applied: shownSlugs,
        appliedFolders: shownFolders.length,
        showFolder: (slug) => {
          router.push(
            `/?${new URLSearchParams({ city: city.slug, collections: slug })}`,
            { scroll: false },
          );
        },
        apply: (slug, only) => {
          if (!only) {
            toggleLayer(slug, true);
            return;
          }
          // Framing a layer does not replace the user's visible layer set.
          const query = new URLSearchParams({ city: city.slug, layers: slug });
          Promise.all([
            fetch("/api/v1/map?" + query).then((response) => response.json()),
            fetch("/api/v1/map/external-references?" + query).then((response) =>
              response.json(),
            ),
          ])
            .then(([catalog, external]) => {
              if (catalog.error || external.error)
                throw new Error(
                  catalog.error?.message ?? external.error.message,
                );
              const points = (catalog.data.items as MapQueryResult["items"])
                .filter(
                  (item) => item.latitude != null && item.longitude != null,
                )
                .map((item) => ({ lat: item.latitude!, lng: item.longitude! }));
              for (const ref of external.data.references as {
                location: { lat: number; lng: number } | null;
              }[])
                if (ref.location) points.push(ref.location);
              canvas.current?.fitPoints(points);
            })
            .catch((error: Error) => setLoadError(error.message));
        },
        selectItem: (key, slug) => {
          const layers = shownSlugs.includes(slug)
            ? shownSlugs
            : [...shownSlugs, slug];
          if (appliedSlots(layers, shownFolders) > maxAppliedLayers) {
            setLoadError(format(t.layerLimit, { max: maxAppliedLayers }));
            return;
          }
          const params = new URLSearchParams(
            withoutLayerPanel(searchParams.toString()).split("?")[1],
          );
          params.set("layers", layers.join(","));
          if (shownFolders.length)
            params.set("collections", shownFolders.join(","));
          params.set("item", key);
          router.push("/?" + params, { scroll: false });
          reveal();
        },
        mapReady: canvasStatus === "ready",
        deleted: (slug) => {
          setHiddenLayers((layers) =>
            layers.filter((layer) => layer.slug !== slug),
          );
          const params = new URLSearchParams(searchParams);
          const remaining = shownSlugs.filter((value) => value !== slug);
          params.set("layers", remaining.length ? remaining.join(",") : "none");
          if (shownFolders.length)
            params.set("collections", shownFolders.join(","));
          for (const key of layerPanelKeys) params.delete(key);
          params.set("layerPanel", "library");
          params.set("layerTab", "mine");
          router.push("/?" + params, { scroll: false });
        },
        pinCenter: () => {
          const point = canvas.current?.getCenter();
          return point ? { latitude: point.lat, longitude: point.lng } : null;
        },
      }}
    >
      <div
        ref={root}
        className={`map-workspace view-map sheet-${sheet} ${visible ? "has-panel" : "panel-closed"} ${fallback ? "map-fallback" : ""} ${detailInPanel ? "has-detail" : ""} ${accountOpen ? "has-account" : ""}`}
        data-canvas={canvasStatus}
        data-map-theme={theme}
        data-panel={visible ? "open" : "closed"}
        style={
          {
            // The panel starts under the measured search cluster and clears the dock.
            "--th-map-top": `${topInset + 12}px`,
            // Provider attribution clears a phone sheet at its real height.
            "--th-sheet-height": `${Math.round(visible ? panelHeight : 0)}px`,
            // Desktop map controls step left of the open account sidebar.
            "--th-account-inset": `${accountInset}px`,
            ...markerCssVars(theme),
          } as CSSProperties
        }
      >
        <h1 className="sr-only">
          {city.name} · {t.mapNav}
        </h1>
        <div className="map-stage">
          {actionsTarget &&
            createPortal(
              <>
                {tripsEnabled && (
                  <TripsEntry locale={locale} active={!!tripPanel} />
                )}
                <button
                  type="button"
                  className="map-float-button"
                  aria-expanded={visible && view === "layers"}
                  aria-controls="map-panel"
                  onClick={showLayers}
                >
                  <LayersIcon size={20} aria-hidden="true" />
                  <span>{t.layersTab}</span>
                  <span className="count-pill">{layerCount}</span>
                </button>
              </>,
              actionsTarget,
            )}
          <div className="map-stage-body" ref={stageBody}>
            {token && canvasStatus !== "failed" ? (
              <MapCanvas
                ref={canvas}
                token={token}
                items={tripDrawn ? noItems : result.items}
                selectedKey={business || tripDrawn ? null : selectedKey}
                extraPoints={tripDrawn ? noExtraPoints : extraPoints}
                route={tripDrawn ? [] : routeLine}
                trip={tripScreen?.geo}
                onTripStop={(stopId) => {
                  tripScreen?.onStop(stopId);
                  setPanelOpen(true);
                  setSheet("half");
                }}
                extraSelectedKey={business?.key ?? null}
                effects={places.mapEffects}
                onSelectExtra={onSelectExtra}
                center={[city.longitude, city.latitude]}
                zoom={cityZoom}
                locale={locale}
                theme={theme}
                t={t}
                padding={padding}
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
              </div>
            )}
            {canvasStatus === "loading" && token && (
              <div className="map-skeleton" aria-hidden="true">
                <span>{t.mapLoading}</span>
              </div>
            )}
            {tip &&
              (() => {
                // A card with a button is no longer a plain tooltip.
                const routeButton = tipRouteButton(tip.key);
                const role = routeButton ? undefined : "tooltip";
                // A Google place shows its own card: name, photo, rating, type.
                const point = extraPoints.find((p) => p.key === tip.key);
                const reviews = reviewPreviews[tip.key];
                // Clamped at render: the review column may arrive after the card opens.
                const left = Math.max(
                  8,
                  Math.min(
                    tip.pointerX + 14,
                    tip.stageWidth -
                      tip.width -
                      (reviews ? tipReviewsWidth : 0) -
                      14,
                  ),
                );
                if (point)
                  return (
                    <div
                      className={`map-tooltip map-place-tip${tip.above ? " tip-above" : ""}`}
                      role={point.tabelog ? undefined : role}
                      style={{
                        left,
                        top: tip.y,
                        width: placeTipWidth,
                        transform: tip.above ? "translateY(-100%)" : undefined,
                      }}
                      onMouseEnter={() => window.clearTimeout(tipTimer.current)}
                      onMouseLeave={() => setTip(null)}
                    >
                      <strong>{point.label || t.routeGooglePlace}</strong>
                      {point.tabelog && (
                        <TabelogLink
                          name={point.tabelog.name}
                          href={point.tabelog.url}
                          t={t}
                          className="tip-tabelog"
                        />
                      )}
                      {routeButton}
                      <TipReviews preview={reviews} t={t} />
                    </div>
                  );
                const item = result.items.find((i) => i.key === tip.key);
                if (!item) return null;
                const kind = markerKind(item);
                return (
                  <div
                    className={`map-tooltip${tip.above ? " tip-above" : ""}`}
                    role={tabelogLink(item) ? undefined : role}
                    style={{
                      left,
                      top: tip.y,
                      transform: tip.above ? "translateY(-100%)" : undefined,
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
                    <TipReviews preview={reviews} t={t} />
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
            {!fallback && (
              <button
                ref={launcher}
                type="button"
                className="map-float-button map-list-toggle"
                aria-expanded={panelOpen}
                aria-controls="map-panel"
                onClick={() => togglePanel(!panelOpen)}
              >
                <LayersIcon size={18} aria-hidden="true" />
                <span>{panelOpen ? t.hideLayers : t.showLayers}</span>
              </button>
            )}
            {canvasStatus === "ready" && (
              <button
                type="button"
                className="map-float-button map-fit"
                onClick={() =>
                  tripDrawn
                    ? tripScreen?.fit()
                    : canvas.current?.fitTo(result.items)
                }
                disabled={!tripDrawn && mapped.length === 0}
              >
                <Crosshair size={16} aria-hidden="true" />
                <span>{t.fitResults}</span>
              </button>
            )}
            {canvasStatus === "ready" && !tripDrawn && routeBar}
            {!routeInPanel && (
              <span className="sr-only" role="status">
                {routeNotice}
              </span>
            )}
            {state.area && (
              <button
                type="button"
                className="map-float-button"
                onClick={() => commit({ area: undefined })}
              >
                <X size={16} aria-hidden="true" />
                <span>{t.clearArea}</span>
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
          // On phones the account sheet covers the panel; keep it out of reach.
          inert={mobile && accountOpen}
          role="region"
          aria-label={t.mapNav}
          tabIndex={-1}
          hidden={!visible}
          onKeyDown={(event) => {
            // Escape closes the panel unless a field or open menu owns the key.
            if (event.key !== "Escape" || event.defaultPrevented) return;
            const target = event.target as HTMLElement;
            if (target.closest("input, textarea, select, details[open]"))
              return;
            if (fallback) return;
            event.preventDefault();
            togglePanel(false);
          }}
        >
          <MapSidebar
            title={screen.title}
            count={screen.count}
            back={screen.back}
            sheet={sheet}
            onSheet={setSheet}
            onClose={fallback ? undefined : () => togglePanel(false)}
            announce={tripScreen ? tripScreen.announce : announce}
            notice={
              loadError && (
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
              )
            }
            footer={<SidebarFooter hasDemo={hasDemo} t={t} />}
            scrollRef={scrollRef}
            onScroll={(event) => {
              if (view === "layers")
                savedScroll.current = event.currentTarget.scrollTop;
            }}
            t={t}
          >
            {screen.body}
          </MapSidebar>
        </div>
        {accountOpen && (
          <aside
            id="map-account-panel"
            className="map-account-panel"
            ref={accountRef}
            aria-labelledby="map-account-title"
            onKeyDown={(event) => {
              // Escape closes the sidebar unless a field or open menu owns the key.
              if (event.key !== "Escape" || event.defaultPrevented) return;
              const target = event.target as HTMLElement;
              if (target.closest("input, textarea, select, details[open]"))
                return;
              event.preventDefault();
              closeAccount();
            }}
          >
            <header className="panel-header">
              <span className="panel-title">
                <h2 id="map-account-title" ref={accountHeading} tabIndex={-1}>
                  {t.account}
                </h2>
              </span>
              <span className="panel-controls">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t.accountClose}
                  title={t.accountClose}
                  onClick={closeAccount}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </span>
            </header>
            <div className="panel-scroll">{accountScreen}</div>
          </aside>
        )}
      </div>
    </LayerWorkspaceContext.Provider>
  );
}
