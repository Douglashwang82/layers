"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  List,
  Map as MapIcon,
  Layers as LayersIcon,
  Crosshair,
  Info,
} from "lucide-react";
import {
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
import { type Copy, type Locale, format } from "@/lib/dictionary";
import {
  MapCanvas,
  type CanvasStatus,
  type MapCanvasHandle,
} from "./map-canvas";
import { MapToolbar } from "./map-toolbar";
import { ActiveLayersPanel } from "./active-layers-panel";
import { MapResults } from "./map-results";
import { ItemPreview } from "./item-preview";
import { track } from "@/lib/track";
import { mapSessionKey } from "@/lib/map-session";
type Sheet = "peek" | "half" | "expanded";
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
  restored,
  contentEnabled,
  layerWrites,
}: {
  initial: MapQueryResult;
  initialDetail: ItemDetail | null;
  city: MapCity;
  t: Copy;
  locale: Locale;
  authenticated: boolean;
  token: string | undefined;
  hasDemo: boolean;
  restored: boolean;
  contentEnabled: boolean;
  layerWrites: boolean;
}) {
  const searchParams = useSearchParams();
  const canvas = useRef<MapCanvasHandle>(null);
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
  const select = (key: string) => {
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
  /* Layout: sheet on mobile, panel/rail on wider screens */
  const mobile = useMedia("(max-width: 800px)");
  const wide = useMedia("(min-width: 1440px)");
  const [sheet, setSheet] = useState<Sheet>("half");
  const [tab, setTab] = useState<"layers" | "results">("results");
  const [limit, setLimit] = useState(20);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setPanelHeight(entry.contentRect.height),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const padding = useMemo(
    () => ({
      top: 0,
      right: 0,
      bottom: mobile && state.view === "map" ? Math.min(panelHeight, 320) : 0,
      left: 0,
    }),
    [mobile, panelHeight, state.view],
  );
  useEffect(() => {
    canvas.current?.resize();
  }, [state.view, sheet]);
  const listView = state.view === "list";
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
    setAnnounce(format(t.resultsInArea, { count: result.total }));
    setLimit(20);
  }, [result.total, result.generatedAt, t.resultsInArea]);
  const mapped = result.items.filter(
    (i) => i.latitude != null && i.longitude != null,
  );
  const unmapped = result.items.filter(
    (i) => i.latitude == null || i.longitude == null,
  );
  const detailInPanel = !!selected && !wide;
  const showDetailRail = !!selected && wide && !listView;
  const layerCount = result.layers.filter((l) => l.status === "ok").length;
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
      onRefresh={() => loadDetail(selected.key)}
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
          : format(t.resultsInArea, { count: result.total })}
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
    appliedSlugs.length === 0 && result.searchScope !== "city" ? (
      <div className="empty">
        <h3>{t.chooseLayer}</h3>
        <p>{t.chooseLayerBody}</p>
        <Link className="button" href="/layers">
          {t.findLayers}
        </Link>
      </div>
    ) : result.total === 0 ? (
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
  const resultsPanel = (
    <>
      {summary}
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
        />
      )}
    </>
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
      className={`map-workspace ${listView ? "view-list" : "view-map"} sheet-${sheet} ${showDetailRail ? "has-rail" : ""} ${detailInPanel ? "has-detail" : ""}`}
      data-canvas={canvasStatus}
    >
      <h1 className="sr-only">
        {city.name} · {t.mapNav}
      </h1>
      <div className="map-stage">
        <MapToolbar
          state={state}
          cityName={city.name}
          t={t}
          contentEnabled={contentEnabled}
          onCommit={(patch) => commit(patch)}
        />
        <div className="map-stage-body" hidden={listView}>
          {token && canvasStatus !== "failed" ? (
            <MapCanvas
              ref={canvas}
              token={token}
              items={result.items}
              selectedKey={selectedKey}
              center={[city.longitude, city.latitude]}
              zoom={10.5}
              locale={locale}
              t={t}
              padding={padding}
              onSelect={(key) => key && select(key)}
              onUserMove={setPendingArea}
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
          <div className="map-controls">
            {canvasStatus === "ready" && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => canvas.current?.fitTo(result.items)}
                disabled={mapped.length === 0}
              >
                <Crosshair size={14} aria-hidden="true" /> {t.fitResults}
              </button>
            )}
            {state.area && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => commit({ area: undefined })}
              >
                {t.clearArea}
              </button>
            )}
            <button
              type="button"
              className="button secondary small"
              onClick={() => setView("list")}
            >
              <List size={14} aria-hidden="true" /> {t.listView}
            </button>
          </div>
        </div>
        {listView && (
          <div className="list-mode-bar">
            <button
              type="button"
              className="button secondary small"
              onClick={() => setView("map")}
            >
              <MapIcon size={14} aria-hidden="true" /> {t.mapView}
            </button>
          </div>
        )}
      </div>
      <div className="map-panel" ref={panelRef} aria-label={t.mapNav}>
        <div className="sheet-handle">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setTab("layers");
              setSheet("half");
            }}
          >
            <LayersIcon size={14} aria-hidden="true" />{" "}
            {format(t.layerCount, { count: layerCount })}
          </button>
          <span className="sheet-buttons">
            <button
              type="button"
              className="icon-button"
              aria-label={t.collapse}
              disabled={sheet === "peek"}
              onClick={() => setSheet(sheet === "expanded" ? "half" : "peek")}
            >
              <ChevronDown size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t.expand}
              disabled={sheet === "expanded"}
              onClick={() => setSheet(sheet === "peek" ? "half" : "expanded")}
            >
              <ChevronUp size={18} aria-hidden="true" />
            </button>
          </span>
        </div>
        {restored && <p className="fine-print restored">{t.restoredLayers}</p>}
        {otherCity.map((l) => (
          <p key={l.slug} className="fine-print">
            {format(t.layerOtherCity, { city: l.cityName ?? "" })}
          </p>
        ))}
        {detailInPanel ? (
          preview
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
                <span className="count-pill">{result.total}</span>
              </button>
            </div>
            <div className="panel-body" role="tabpanel">
              {tab === "layers" ? layersPanel : resultsPanel}
            </div>
          </>
        )}
        {footer}
      </div>
      {showDetailRail && <aside className="map-rail">{preview}</aside>}
    </div>
  );
}
