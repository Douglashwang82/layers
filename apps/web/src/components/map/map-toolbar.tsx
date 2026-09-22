"use client";
import { useState, type FormEvent } from "react";
import { Search, X, CalendarDays } from "lucide-react";
import {
  itemTypes,
  type DateFilter,
  type ItemType,
  type MapState,
} from "@taiwanhub/shared";
import { type Copy, format } from "@/lib/dictionary";
/** Search (with visible scope), date presets and type chips. Every change is a committed filter. */
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
  const [datesOpen, setDatesOpen] = useState(false);
  const custom = !["upcoming", "today", "weekend"].includes(state.date);
  const [from, setFrom] = useState(custom ? state.date.slice(0, 10) : "");
  const [to, setTo] = useState(custom ? state.date.slice(-10) : "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCommit({ q: draft.trim(), scope: draft.trim() ? scope : "layers" });
  };
  const applyDates = (e: FormEvent) => {
    e.preventDefault();
    if (!from) return;
    const date: DateFilter = to && to !== from ? `${from}..${to}` : from;
    onCommit({ date });
    setDatesOpen(false);
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
  return (
    <div className="map-toolbar">
      <form className="map-search" role="search" onSubmit={submit}>
        <label className="sr-only" htmlFor="map-search">
          {t.searchLabel}
        </label>
        <Search size={18} aria-hidden="true" />
        <input
          id="map-search"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={format(t.searchCity, { city: cityName })}
        />
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
        <button type="submit" className="button small">
          {t.search}
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
            {t.exitSearch}
          </button>
        )}
      </form>
      <div className="map-filters">
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
              onClick={() => onCommit({ date: value })}
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
            {custom ? state.date.replace("..", " – ") : t.pickDates}
          </button>
        </div>
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
  );
}
