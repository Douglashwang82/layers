"use client";
import { ArrowDown, ArrowUp, ExternalLink, X } from "lucide-react";
import { type Copy, format } from "@/lib/dictionary";
import {
  maxRouteStops,
  routeLinks,
  travelModes,
  type RouteStop,
  type TravelMode,
} from "@/lib/route-link";
import { track } from "@/lib/track";
/** A planned stop: the map key it came from and a LocalLink-side label. */
export type PlannedStop = RouteStop & { key: string; label: string };
/**
 * The route planner (docs/plans/map-route-links-plan.md): ordered stops,
 * travel mode and the Google Maps links. Stops are picked on the map.
 */
export function RoutePlanner({
  stops,
  mode,
  notice,
  t,
  onMode,
  onChange,
  onDone,
}: {
  stops: PlannedStop[];
  mode: TravelMode;
  /** The outcome of the last map tap (added, removed, route full). */
  notice: string;
  t: Copy;
  onMode: (mode: TravelMode) => void;
  onChange: (stops: PlannedStop[]) => void;
  onDone: () => void;
}) {
  const links = routeLinks(stops, mode);
  const move = (from: number, to: number) => {
    const next = [...stops];
    const [stop] = next.splice(from, 1);
    next.splice(to, 0, stop);
    onChange(next);
  };
  const place = (n: number) => format(t.routeStop, { n });
  const modeLabels: Record<TravelMode, string> = {
    walking: t.routeWalk,
    driving: t.routeDrive,
    transit: t.routeTransit,
  };
  return (
    <section className="route-planner" aria-labelledby="route-heading">
      <h2 id="route-heading">{t.routeTitle}</h2>
      <p className="fine-print">
        {format(t.routeHint, { max: maxRouteStops })}
      </p>
      <p className="fine-print" role="status">
        {notice}
      </p>
      {stops.length ? (
        <ol className="route-stops">
          {stops.map((stop, i) => (
            <li key={stop.key}>
              <span className="route-number" aria-hidden="true">
                {i + 1}
              </span>
              <span className="route-label">{stop.label}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={format(t.routeMoveUp, {
                  n: i + 1,
                  name: stop.label,
                })}
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={format(t.routeMoveDown, {
                  n: i + 1,
                  name: stop.label,
                })}
                disabled={i === stops.length - 1}
                onClick={() => move(i, i + 1)}
              >
                <ArrowDown size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={format(t.routeRemove, {
                  n: i + 1,
                  name: stop.label,
                })}
                onClick={() => onChange(stops.filter((_, j) => j !== i))}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">{t.routeEmpty}</p>
      )}
      <div
        className="segmented route-modes"
        role="group"
        aria-label={t.routeTravelMode}
      >
        {travelModes.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            className={mode === value ? "on" : ""}
            onClick={() => onMode(value)}
          >
            {modeLabels[value]}
          </button>
        ))}
      </div>
      {stops.length === 1 && <p className="fine-print">{t.routeNeedTwo}</p>}
      {links.length > 0 && (
        <div className="route-links">
          {links.map((link, i) => (
            <a
              key={link.url}
              className="button small"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                track("route_opened", {
                  stops: stops.length,
                  links: links.length,
                  mode,
                })
              }
            >
              <ExternalLink size={16} aria-hidden="true" />
              {links.length === 1
                ? t.routeOpen
                : format(t.routeOpenPart, {
                    n: i + 1,
                    from: place(link.from),
                    to: place(link.to),
                  })}
            </a>
          ))}
          <p className="fine-print">
            {mode === "transit"
              ? t.routeTransitNote
              : links.length > 1
                ? t.routeSplitNote
                : t.routeStartNote}
          </p>
        </div>
      )}
      <div className="actions">
        <button type="button" className="button small" onClick={onDone}>
          {t.routeDone}
        </button>
        {stops.length > 0 && (
          <button
            type="button"
            className="button secondary small"
            onClick={() => onChange([])}
          >
            {t.routeClear}
          </button>
        )}
      </div>
    </section>
  );
}
