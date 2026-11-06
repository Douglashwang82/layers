"use client";
import { CalendarDays, Info } from "lucide-react";
import type { LayerEvent } from "@taiwanhub/shared";
import { LayerLink as Link } from "../layers/workspace-navigation";
import type { Copy, Locale } from "@/lib/dictionary";
import { eventRange, eventTitle } from "@/lib/event-time";

/** The sign-in prompt or first-run starter for a map with nothing on it. */
export function MapEmptyState({
  firstRun,
  dailyPickSlug,
  t,
  onSeePick,
}: {
  /** A signed-in member with no layers of their own gets a starter. */
  firstRun: boolean;
  dailyPickSlug: string | null;
  t: Copy;
  onSeePick: (slug: string) => void;
}) {
  if (firstRun)
    return (
      <div className="empty first-run-starter">
        <h3>{t.starterTitle}</h3>
        <p>{t.starterBody}</p>
        <div className="actions">
          {dailyPickSlug && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => onSeePick(dailyPickSlug)}
            >
              {t.starterSeePick}
            </button>
          )}
          <Link className="button small" href="/layers/new">
            {t.starterStartLayer}
          </Link>
        </div>
        <p className="fine-print">{t.starterJoinGroup}</p>
      </div>
    );
  return (
    <div className="empty">
      <h3>{t.mvpEmptyTitle}</h3>
      <p>{t.signInForLayers}</p>
      <div className="actions">
        <Link className="button small" href="/sign-in?next=%2F">
          {t.signIn}
        </Link>
      </div>
    </div>
  );
}

/** Upcoming events at the open place. */
export function AttachedEvents({
  events,
  locale,
  timeZone,
  t,
}: {
  events: LayerEvent[] | undefined;
  locale: Locale;
  timeZone: string;
  t: Copy;
}) {
  if (!events?.length) return null;
  return (
    <section className="attached-events" aria-labelledby="attached-events">
      <h3 id="attached-events">
        <CalendarDays size={16} aria-hidden="true" /> {t.upcomingEvents}
      </h3>
      <ul className="event-list">
        {events.map((event) => (
          <li key={event.id}>
            <span className="event-when">
              {eventRange(event, locale, timeZone)}
            </span>
            <b>{eventTitle(event, locale)}</b>
            {event.note && <span className="muted">{event.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The demo notice and the About text, at the end of every screen. */
export function SidebarFooter({ hasDemo, t }: { hasDemo: boolean; t: Copy }) {
  return (
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
}
