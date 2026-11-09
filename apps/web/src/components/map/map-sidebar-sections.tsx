"use client";
import { CalendarDays, Info } from "lucide-react";
import type { LayerEvent } from "@taiwanhub/shared";
import { LayerLink as Link } from "../layers/workspace-navigation";
import type { Copy, Locale } from "@/lib/dictionary";
import { eventRange, eventTitle } from "@/lib/event-time";

/** The sign-in prompt for a signed-out visitor's empty map. */
export function MapEmptyState({ t }: { t: Copy }) {
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
