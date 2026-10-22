"use client";
import type { MouseEvent } from "react";
import {
  CalendarDays,
  FileText,
  Utensils,
  Layers,
  Globe,
  MapPinOff,
  ExternalLink,
} from "lucide-react";
import type { LayerEvent } from "@taiwanhub/shared";
import type { MapItem } from "@/features/map/query";
import { eventRange, eventTitle } from "@/lib/event-time";
import {
  type Copy,
  type Locale,
  localized,
  dateLabel,
  format,
} from "@/lib/dictionary";
import { Photo as Image } from "@/components/photo";
import { markerKind, markerLabel } from "@/lib/marker-presentation";
import { tabelogLink } from "@/lib/tabelog";
const icons = {
  place: Utensils,
  event: CalendarDays,
  content: FileText,
} as const;
export function itemTitle(item: MapItem, locale: Locale) {
  return localized(item, locale);
}
export function ItemMeta({
  item,
  t,
  locale,
}: {
  item: MapItem;
  t: Copy;
  locale: Locale;
}) {
  if (item.customScope)
    return (
      <span className="row-meta">
        <span className="status">
          {item.customScope === "group" ? t.groupPlace : t.privatePlace}
        </span>
      </span>
    );
  if (item.type === "place")
    return (
      <span className="row-meta">
        {item.score === null ? (
          <span className="score-empty">{t.noVotes}</span>
        ) : (
          <span>
            <b>{item.score}%</b> {t.score} · {item.responses} {t.responses}
          </span>
        )}
      </span>
    );
  if (item.type === "event")
    return (
      <span className="row-meta">
        {item.startTime && <span>{dateLabel(item.startTime, locale)}</span>}
        {item.eventStatus && item.eventStatus !== "scheduled" && (
          <span className="status status-hidden">
            {item.eventStatus === "cancelled" ? t.cancelled : t.postponed}
          </span>
        )}
        {item.organizerName && <span>· {item.organizerName}</span>}
      </span>
    );
  return (
    <span className="row-meta">
      {item.authorName && (
        <span>{format(t.author, { name: item.authorName })}</span>
      )}
      {item.publishedAt && <span>· {dateLabel(item.publishedAt, locale)}</span>}
    </span>
  );
}
function LocationLabel({ item, t }: { item: MapItem; t: Copy }) {
  if (item.locationStatus === "online")
    return (
      <span className="row-location">
        <Globe size={13} aria-hidden="true" /> {t.onlineLabel}
      </span>
    );
  if (item.locationStatus === "citywide")
    return (
      <span className="row-location">
        <Globe size={13} aria-hidden="true" /> {t.cityWide}
      </span>
    );
  if (item.latitude == null)
    return (
      <span className="row-location">
        <MapPinOff size={13} aria-hidden="true" /> {t.noMapLocation}
      </span>
    );
  return item.neighborhood ? (
    <span className="row-location">{item.neighborhood}</span>
  ) : null;
}
/** Opens a Tabelog search for a food place in Japan, in a new tab. */
export function TabelogLink({
  item,
  t,
  className,
}: {
  item: MapItem;
  t: Copy;
  className: string;
}) {
  const href = tabelogLink(item);
  if (!href) return null;
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={format(t.tabelogSearchFor, { name: item.name })}
    >
      <ExternalLink size={13} aria-hidden="true" />
      {t.tabelogSearch}
    </a>
  );
}
/** The next attached event at a place, as a one-line row note. */
export function NextEvent({
  events,
  locale,
  timeZone,
}: {
  events: LayerEvent[] | undefined;
  locale: Locale;
  timeZone: string;
}) {
  const next = events?.[0];
  if (!next) return null;
  return (
    <span className="row-event">
      <CalendarDays size={13} aria-hidden="true" />
      <span>
        {eventRange(next, locale, timeZone)} · {eventTitle(next, locale)}
      </span>
      {events.length > 1 && <span className="muted">+{events.length - 1}</span>}
    </span>
  );
}
export function ResultRow({
  item,
  t,
  locale,
  selected,
  onSelect,
  onHover,
  events,
  timeZone = "America/Chicago",
}: {
  item: MapItem;
  t: Copy;
  locale: Locale;
  selected: boolean;
  onSelect: (key: string) => void;
  /** Row hover/focus highlights its pin; it never changes the URL or camera. */
  onHover?: (key: string | null) => void;
  /** Upcoming events attached to this place in the applied layers. */
  events?: LayerEvent[];
  timeZone?: string;
}) {
  const Icon = icons[item.type];
  const kind = markerKind(item);
  const name = itemTitle(item, locale);
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
      return;
    e.preventDefault();
    onSelect(item.key);
  };
  return (
    <li
      className={`result-row ${selected ? "selected" : ""}`}
      data-type={item.type}
      data-kind={kind}
      onMouseEnter={() => onHover?.(item.key)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(item.key)}
      onBlur={() => onHover?.(null)}
    >
      <a
        href={item.href}
        onClick={handle}
        aria-current={selected ? "true" : undefined}
      >
        <span className="row-thumb">
          {item.image ? (
            <Image src={item.image} alt="" fill sizes="72px" />
          ) : (
            <Icon size={20} aria-hidden="true" />
          )}
        </span>
        <span className="row-body">
          <span className="row-kicker">
            <span
              className="kind-dot"
              style={{ background: `var(--marker-${kind})` }}
              title={markerLabel(kind, t)}
              aria-hidden="true"
            />
            <Icon size={13} aria-hidden="true" />
            <span>{item.category}</span>
            {item.isDemo && <span className="demo-pill">{t.demoShort}</span>}
          </span>
          <span className="row-title">{name}</span>
          <ItemMeta {...{ item, t, locale }} />
          <NextEvent events={events} locale={locale} timeZone={timeZone} />
          <span className="row-foot">
            <LocationLabel item={item} t={t} />
            {item.layers.length > 1 && (
              <span className="row-layers">
                <Layers size={13} aria-hidden="true" />
                {format(t.inLayers, { count: item.layers.length })}
              </span>
            )}
          </span>
        </span>
      </a>
      <TabelogLink item={item} t={t} className="row-tabelog" />
    </li>
  );
}
export function MapResults({
  items,
  unmapped,
  t,
  locale,
  selectedKey,
  onSelect,
  limit,
  onMore,
  onHover,
  events = {},
  timeZone,
}: {
  items: MapItem[];
  unmapped: MapItem[];
  t: Copy;
  locale: Locale;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  limit: number;
  onMore: () => void;
  onHover?: (key: string | null) => void;
  events?: Record<string, LayerEvent[]>;
  timeZone?: string;
}) {
  const visible = items.slice(0, limit);
  return (
    <>
      <ul className="result-list" aria-label={t.resultsTab}>
        {visible.map((item) => (
          <ResultRow
            key={item.key}
            {...{ item, t, locale, onSelect, onHover, timeZone }}
            events={events[item.key]}
            selected={item.key === selectedKey}
          />
        ))}
      </ul>
      {items.length > limit && (
        <button
          type="button"
          className="button secondary small show-more"
          onClick={onMore}
        >
          {t.showMore} ({items.length - limit})
        </button>
      )}
      {unmapped.length > 0 && (
        <section className="unmapped" aria-labelledby="unmapped-heading">
          <h3 id="unmapped-heading">{t.alsoInLayers}</h3>
          <p className="fine-print">{t.notLimited}</p>
          <ul className="result-list">
            {unmapped.map((item) => (
              <ResultRow
                key={item.key}
                {...{ item, t, locale, onSelect, timeZone }}
                events={events[item.key]}
                selected={item.key === selectedKey}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
