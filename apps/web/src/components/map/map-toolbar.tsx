"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Search, X, CalendarDays, SlidersHorizontal } from "lucide-react";
import {
  itemTypes,
  type DateFilter,
  type ItemType,
  type MapState,
} from "@taiwanhub/shared";
import { type Copy, format } from "@/lib/dictionary";
/**
 * Search, category chips and a filters disclosure for date and search scope.
 * Every change is a committed filter; non-default ones stay visible as chips.
 */
export function MapToolbar({
  state,
  cityName,
  t,
  contentEnabled,
  onCommit,
}: {
  state: MapState;
  cityName: string;
  t: Copy;
  contentEnabled: boolean;
  onCommit: (patch: Partial<MapState>) => void;
}) {
  const [draft, setDraft] = useState(state.q);
  const [scope, setScope] = useState<MapState["scope"]>(state.scope);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const filterMenu = useRef<HTMLDivElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const custom = !["upcoming", "today", "weekend"].includes(state.date);
  const [from, setFrom] = useState(custom ? state.date.slice(0, 10) : "");
  const [to, setTo] = useState(custom ? state.date.slice(-10) : "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCommit({ q: draft.trim(), scope: draft.trim() ? scope : "layers" });
  };
  const closeFilters = (restoreFocus: boolean) => {
    setFiltersOpen(false);
    setDatesOpen(false);
    if (restoreFocus) filterButton.current?.focus();
  };
  const applyDates = (e: FormEvent) => {
    e.preventDefault();
    if (!from) return;
    const date: DateFilter = to && to !== from ? `${from}..${to}` : from;
    onCommit({ date });
    closeFilters(true);
  };
  const selectedType: ItemType | "all" =
    state.types && state.types.length === 1 ? state.types[0] : "all";
  const typeOptions: [ItemType | "all", string][] = [
    ["all", t.typeAll],
    ["place", t.typePlaces],
    ["event", t.typeEvents],
    ...(contentEnabled
      ? ([["content", t.typeContent]] as [ItemType, string][])
      : []),
  ];
  const dateLabel = custom
    ? state.date.replace("..", " – ")
    : state.date === "today"
      ? t.today
      : state.date === "weekend"
        ? t.weekend
        : t.upcoming;
  const cityScope = state.scope === "city" && !!state.q;
  const appliedCount =
    (state.date !== "upcoming" ? 1 : 0) + (cityScope ? 1 : 0);
  const [searchTarget, setSearchTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSearchTarget(document.getElementById("map-header-search"));
  }, []);
  useEffect(() => {
    setDraft(state.q);
    setScope(state.scope);
  }, [state.q, state.scope]);
  // The disclosure is non-modal: an outside press dismisses it.
  useEffect(() => {
    if (!filtersOpen) return;
    const close = (event: PointerEvent) => {
      if (!filterMenu.current?.contains(event.target as Node))
        closeFilters(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [filtersOpen]);
  const onFilterKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    closeFilters(true);
  };
  const searchForm = (
    <form className="map-search" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor="map-search">
        {t.searchLabel}
      </label>
      <input
        id="map-search"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={format(t.searchCity, { city: cityName })}
      />
      <button type="submit" className="icon-button" aria-label={t.search}>
        <Search size={18} aria-hidden="true" />
      </button>
      {state.q && (
        <button
          type="button"
          className="button secondary small"
          onClick={() => {
            setDraft("");
            setScope("layers");
            onCommit({ q: "", scope: "layers" });
          }}
        >
          <X size={14} aria-hidden="true" />
          <span className="sr-only">{t.exitSearch}</span>
        </button>
      )}
    </form>
  );
  const chip = (label: string, clear: () => void) => (
    <li key={label}>
      <button
        type="button"
        className="filter-chip"
        aria-label={format(t.clearFilter, { label })}
        onClick={clear}
      >
        {label}
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
  const toolbar = (
    <div className="map-toolbar">
      {searchForm}
      <div className="map-filters">
        <div className="segmented" role="group" aria-label={t.category}>
          {typeOptions.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={selectedType === value}
              className={selectedType === value ? "on" : ""}
              onClick={() =>
                onCommit({ types: value === "all" ? [...itemTypes] : [value] })
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="filter-menu" ref={filterMenu} onKeyDown={onFilterKey}>
          <button
            ref={filterButton}
            type="button"
            className="map-float-button"
            aria-expanded={filtersOpen}
            aria-controls="map-filter-popover"
            onClick={() => {
              if (filtersOpen) closeFilters(false);
              else setFiltersOpen(true);
            }}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span>{t.filters}</span>
            {appliedCount > 0 && (
              <span className="count-pill">{appliedCount}</span>
            )}
          </button>
          {filtersOpen && (
            <div
              id="map-filter-popover"
              className="filter-popover"
              role="group"
              aria-label={t.filters}
            >
              <div className="scope-toggle" role="group" aria-label={t.search}>
                <button
                  type="button"
                  className={scope === "layers" ? "on" : ""}
                  aria-pressed={scope === "layers"}
                  onClick={() => setScope("layers")}
                >
                  {t.searchInLayers}
                </button>
                <button
                  type="button"
                  className={scope === "city" ? "on" : ""}
                  aria-pressed={scope === "city"}
                  onClick={() => setScope("city")}
                >
                  {format(t.searchAllCity, { city: cityName })}
                </button>
              </div>
              <div className="segmented" role="group" aria-label={t.date}>
                {(
                  [
                    ["upcoming", t.upcoming],
                    ["today", t.today],
                    ["weekend", t.weekend],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={state.date === value}
                    className={state.date === value ? "on" : ""}
                    onClick={() => {
                      onCommit({ date: value });
                      closeFilters(true);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={custom}
                  aria-expanded={datesOpen}
                  className={custom ? "on" : ""}
                  onClick={() => setDatesOpen((o) => !o)}
                >
                  <CalendarDays size={14} aria-hidden="true" />
                  {custom ? dateLabel : t.pickDates}
                </button>
              </div>
              {datesOpen && (
                <form className="date-picker" onSubmit={applyDates}>
                  <label>
                    {t.dateFrom}
                    <input
                      type="date"
                      value={from}
                      required
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    {t.dateTo}
                    <input
                      type="date"
                      value={to}
                      min={from || undefined}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <button type="submit" className="button small">
                    {t.applyDates}
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => setDatesOpen(false)}
                  >
                    {t.close}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
        {appliedCount > 0 && (
          <ul className="applied-filters" aria-label={t.appliedFilters}>
            {state.date !== "upcoming" &&
              chip(dateLabel, () => onCommit({ date: "upcoming" }))}
            {cityScope &&
              chip(format(t.searchAllCity, { city: cityName }), () =>
                onCommit({ scope: "layers" }),
              )}
          </ul>
        )}
      </div>
    </div>
  );
  return searchTarget ? createPortal(toolbar, searchTarget) : toolbar;
}
