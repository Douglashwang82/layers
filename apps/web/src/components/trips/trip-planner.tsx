"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  MapPinOff,
  Pin,
  RotateCcw,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { distanceUnit, formatDistance } from "@taiwanhub/shared";
import { api } from "@/components/actions";
import { routeLinks } from "@/lib/route-link";
import { tripCopy } from "@/lib/trip-copy";
import type {
  TripDayView,
  TripEndpointView,
  TripStopView,
  TripView,
} from "@/features/trips/repository";
import { TripMap, dayColor } from "./trip-map";

type Toast = { stopId: string; name: string } | null;

function dateLabel(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * A trip: day chips filter the map and the list together, so they always
 * agree. Every change goes to the server, which re-orders only the affected
 * day(s) and returns the new view; a stale revision reloads it.
 */
export function TripPlanner({
  initial,
  locale,
  mapToken,
}: {
  initial: TripView;
  locale: string;
  mapToken?: string;
}) {
  const t = tripCopy(locale);
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [focus, setFocus] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [mapOff, setMapOff] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const unit = distanceUnit(view.trip.citySlug);
  const distance = (m: number) => formatDistance(m, unit);
  const name = (s: Pick<TripStopView, "label" | "labelChinese">) =>
    (locale === "zh-TW" && s.labelChinese) || s.label || t.unnamed;
  const base = `trips/${view.trip.id}`;

  async function run(path: string, method: string, body: object = {}) {
    setBusy(true);
    setNotice("");
    try {
      const next: TripView = await api(path, method, {
        ...body,
        expectedRevision: view.revision,
      });
      setView(next);
      return true;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 409) {
        setView(await api(base, "GET"));
        setNotice(t.conflict);
      } else setNotice((e as Error).message || t.failed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const remove = async (stop: TripStopView) => {
    if (await run(`${base}/stops/${stop.id}`, "PATCH", { status: "removed" }))
      setToast({ stopId: stop.id, name: name(stop) });
  };
  const restore = async (stopId: string) => {
    setToast(null);
    await run(`${base}/stops/${stopId}`, "PATCH", { status: "active" });
  };
  const moveTo = (stop: TripStopView, dayId: string | null) =>
    run(`${base}/stops/${stop.id}`, "PATCH", { dayId });
  const reorder = (day: TripDayView, from: number, to: number) => {
    const order = day.stops.map((s) => s.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    return run(`${base}/days/${day.id}`, "PATCH", { order });
  };
  const baseName = view.base ? name(view.base) : "";
  const setBase = (itemId: string) =>
    run(base, "PATCH", { baseItemId: itemId || null });
  const setEndpoint = (day: TripDayView, side: "start" | "end", v: string) => {
    const open = side === "start" ? "first_stop" : "last_stop";
    if (v === "base")
      return run(`${base}/days/${day.id}`, "PATCH", {
        [`${side}Kind`]: "base",
      });
    if (v.startsWith("item:"))
      return run(`${base}/days/${day.id}`, "PATCH", {
        [`${side}Kind`]: "item",
        [`${side}ItemId`]: v.slice(5),
      });
    return run(`${base}/days/${day.id}`, "PATCH", { [`${side}Kind`]: open });
  };
  /** Candidates, plus the place currently in use when it is not one of them. */
  const choices = (current: TripEndpointView | null) => [
    ...(current && !view.baseCandidates.some((c) => c.itemId === current.itemId)
      ? [current]
      : []),
    ...view.baseCandidates,
  ];
  const deleteTrip = async () => {
    setBusy(true);
    try {
      await api(base, "DELETE");
      router.push("/trips");
    } catch (e) {
      setNotice((e as Error).message || t.failed);
      setBusy(false);
    }
  };

  const shown = view.days
    .map((day, index) => ({ day, index }))
    .filter(({ day }) => focus === "all" || focus === day.id);
  const totalStops = view.days.reduce((n, d) => n + d.stops.length, 0);

  const stopMenu = (stop: TripStopView, dayId: string | null) =>
    view.canEdit && (
      <>
        <label className="sr-only" htmlFor={`move-${stop.id}`}>
          {t.moveTo(name(stop))}
        </label>
        <select
          id={`move-${stop.id}`}
          className="trip-move"
          value={dayId ?? ""}
          disabled={busy}
          onChange={(e) => void moveTo(stop, e.target.value || null)}
        >
          {view.days.map((d, i) => (
            <option key={d.id} value={d.id}>
              {t.day(i + 1)}
            </option>
          ))}
          <option value="">{t.notScheduledOption}</option>
        </select>
        <button
          type="button"
          className="icon-button"
          aria-label={t.remove(name(stop))}
          disabled={busy}
          onClick={() => void remove(stop)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </>
    );

  return (
    <div className="container page-bottom trip-planner">
      <Link className="text-button" href="/trips">
        {t.backToTrips}
      </Link>
      <div className="page-header">
        <h1>{view.trip.title}</h1>
        <p className="muted">
          {view.trip.startsOn === view.trip.endsOn
            ? dateLabel(view.trip.startsOn, locale)
            : `${dateLabel(view.trip.startsOn, locale)} – ${dateLabel(view.trip.endsOn, locale)}`}{" "}
          · {view.trip.cityName} · {t.stops(totalStops)} ·{" "}
          {view.trip.audience === "group"
            ? t.groupTrip(view.trip.ownerName)
            : t.privateTrip}
        </p>
        {!view.canEdit && <p className="notice">{t.viewOnly}</p>}
      </div>

      {notice && (
        <p className="message error-message" role="alert">
          {notice}
        </p>
      )}
      {toast && (
        <p className="trip-toast" role="status">
          {t.removedToast(toast.name)}{" "}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void restore(toast.stopId)}
          >
            {t.undo}
          </button>
        </p>
      )}
      {view.unavailableCount > 0 && (
        <p className="notice" role="status">
          {t.unavailable(view.unavailableCount)}{" "}
          {view.canEdit && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void run(`${base}/remove-unavailable`, "POST")}
            >
              {t.removeUnavailable}
            </button>
          )}
        </p>
      )}

      {(view.canEdit || view.base) && (
        <section className="trip-base" aria-labelledby="trip-base-heading">
          <h2 id="trip-base-heading" className="sr-only">
            {t.baseHeading}
          </h2>
          {view.canEdit ? (
            <>
              <div className="trip-base-row">
                <label htmlFor="trip-base-select">{t.baseLabel}</label>
                <select
                  id="trip-base-select"
                  data-testid="trip-base-select"
                  value={view.base?.itemId ?? ""}
                  disabled={busy}
                  onChange={(e) => void setBase(e.target.value)}
                >
                  <option value="">{t.baseNone}</option>
                  {choices(view.base).map((c) => (
                    <option key={c.itemId} value={c.itemId}>
                      {(locale === "zh-TW" && c.labelChinese) ||
                        c.label ||
                        t.unnamed}
                    </option>
                  ))}
                </select>
              </div>
              <p className="fine-print">
                {t.baseHint} {t.baseAlreadyStop}
              </p>
              {view.baseUnavailable && (
                <p className="notice" role="status">
                  {t.baseUnavailable}
                </p>
              )}
            </>
          ) : (
            view.base && (
              <p>
                <strong>{t.baseHeading}:</strong> {baseName}
              </p>
            )
          )}
        </section>
      )}

      <div className="trip-chips" role="group" aria-label={t.trips}>
        <button
          type="button"
          aria-pressed={focus === "all"}
          className={focus === "all" ? "chip on" : "chip"}
          onClick={() => setFocus("all")}
        >
          {t.allDays}
        </button>
        {view.days.map((day, i) => (
          <button
            key={day.id}
            type="button"
            aria-pressed={focus === day.id}
            className={focus === day.id ? "chip on" : "chip"}
            onClick={() => setFocus(day.id)}
          >
            <span
              className="trip-swatch"
              style={{ background: dayColor(i) }}
              aria-hidden="true"
            />
            {t.day(i + 1)} · {dateLabel(day.date, locale)}
          </button>
        ))}
      </div>

      {!mapOff ? (
        <>
          <TripMap
            days={view.days}
            focus={focus}
            label={view.trip.title}
            token={mapToken}
            onUnavailable={() => setMapOff(true)}
          />
          <p className="fine-print">{t.legend}</p>
        </>
      ) : (
        <p className="fine-print">{t.mapUnavailable}</p>
      )}

      {view.canEdit && (
        <div className="actions">
          <button
            type="button"
            className="button secondary small"
            disabled={busy}
            onClick={() =>
              void run(`${base}/optimize`, "POST", { scope: "all" })
            }
          >
            <Shuffle size={16} aria-hidden="true" />
            {t.replanAll}
          </button>
        </div>
      )}

      {shown.map(({ day, index }) => {
        const located = day.stops.filter((s) => s.location);
        const waypoint = (p: {
          location: { lat: number; lng: number } | null;
          providerPlaceId: string | null;
        }) => ({
          lat: p.location!.lat,
          lng: p.location!.lng,
          placeId: p.providerPlaceId,
        });
        const links = routeLinks(
          [
            ...(located.length && day.start ? [waypoint(day.start)] : []),
            ...located.map(waypoint),
            ...(located.length && day.end ? [waypoint(day.end)] : []),
          ],
          "walking",
        );
        return (
          <section
            key={day.id}
            className="trip-day"
            aria-labelledby={`day-${day.id}`}
            data-testid="trip-day"
          >
            <div className="trip-day-heading">
              <h2 id={`day-${day.id}`}>
                <span
                  className="trip-swatch"
                  style={{ background: dayColor(index) }}
                  aria-hidden="true"
                />
                {t.dayHeading(index + 1, dateLabel(day.date, locale))}
              </h2>
              {day.orderMode === "manual" && (
                <span className="trip-badge">{t.yourOrder}</span>
              )}
              {view.canEdit && day.stops.length > 1 && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(`${base}/optimize`, "POST", {
                      scope: "day",
                      dayId: day.id,
                    })
                  }
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  {day.orderMode === "manual" ? t.autoOrder : t.reorderDay}
                </button>
              )}
            </div>
            {view.canEdit && (
              <div className="trip-endpoints">
                {(["start", "end"] as const).map((side) => {
                  const current = day[side];
                  const kind = day[`${side}Kind`];
                  const value =
                    kind === "item" && current
                      ? `item:${current.itemId}`
                      : kind === "base"
                        ? "base"
                        : "open";
                  const id = `${side}-${day.id}`;
                  return (
                    <label key={side} htmlFor={id}>
                      {side === "start" ? t.dayStart : t.dayEnd}
                      <select
                        id={id}
                        data-testid={`trip-${side}-select`}
                        value={value}
                        disabled={busy}
                        onChange={(e) =>
                          void setEndpoint(day, side, e.target.value)
                        }
                      >
                        <option value="base">
                          {side === "start" ? t.startBase : t.endBase}
                          {view.base ? `: ${baseName}` : ""}
                        </option>
                        <option value="open">
                          {side === "start" ? t.startFirst : t.endLast}
                        </option>
                        {choices(kind === "item" ? current : null).map((c) => (
                          <option key={c.itemId} value={`item:${c.itemId}`}>
                            {(locale === "zh-TW" && c.labelChinese) ||
                              c.label ||
                              t.unnamed}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            )}
            {day.stops.length === 0 ? (
              <p className="muted">{t.freeDay}</p>
            ) : (
              <>
                {day.start && (
                  <p className="trip-endpoint" data-testid="trip-day-start">
                    <span
                      className="trip-number trip-number-base"
                      aria-hidden="true"
                    >
                      {"⌂"}
                    </span>
                    {t.from(name(day.start))}
                  </p>
                )}
                <ol className="trip-stops">
                  {day.stops.map((stop, i) => (
                    <li key={stop.id} data-testid="trip-stop">
                      <span
                        className="trip-number"
                        style={{ background: dayColor(index) }}
                        aria-hidden="true"
                      >
                        {i + 1}
                      </span>
                      <span className="trip-stop-text">
                        <span className="trip-stop-name">{name(stop)}</span>
                        <span className="fine-print">
                          {!stop.location ? (
                            <>
                              <MapPinOff size={12} aria-hidden="true" />{" "}
                              {t.noLocation}
                            </>
                          ) : stop.legMeters !== null ? (
                            t.about(distance(stop.legMeters))
                          ) : null}
                          {stop.pinned && (
                            <>
                              {" "}
                              <Pin size={12} aria-hidden="true" /> {t.pinned}
                            </>
                          )}
                        </span>
                      </span>
                      {view.canEdit && (
                        <>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={t.moveUp(name(stop))}
                            disabled={busy || i === 0}
                            onClick={() => void reorder(day, i, i - 1)}
                          >
                            <ArrowUp size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={t.moveDown(name(stop))}
                            disabled={busy || i === day.stops.length - 1}
                            onClick={() => void reorder(day, i, i + 1)}
                          >
                            <ArrowDown size={16} aria-hidden="true" />
                          </button>
                        </>
                      )}
                      {stopMenu(stop, day.id)}
                    </li>
                  ))}
                </ol>
                {day.end && (
                  <p className="trip-endpoint" data-testid="trip-day-end">
                    <span
                      className="trip-number trip-number-base"
                      aria-hidden="true"
                    >
                      {"⌂"}
                    </span>
                    <span>
                      {t.backTo(name(day.end))}
                      {day.endLegMeters !== null && (
                        <span className="fine-print">
                          {" "}
                          · {t.endLeg(distance(day.endLegMeters))}
                        </span>
                      )}
                    </span>
                  </p>
                )}
              </>
            )}
            {day.totalMeters > 0 && (
              <p className="fine-print" data-testid="trip-day-total">
                {t.dayTotal(distance(day.totalMeters))}
              </p>
            )}
            {links.length > 0 && (
              <div className="route-links">
                {links.map((link, part) => (
                  <a
                    key={link.url}
                    className="button small secondary"
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    {links.length === 1
                      ? t.openInMaps(index + 1)
                      : t.openPart(index + 1, part + 1)}
                  </a>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {view.notScheduled.length > 0 && (
        <section className="trip-day" aria-labelledby="not-scheduled">
          <h2 id="not-scheduled">{t.notScheduled}</h2>
          <ul className="trip-stops">
            {view.notScheduled.map((stop) => (
              <li key={stop.id} data-testid="trip-unscheduled">
                <span className="trip-stop-text">
                  <span className="trip-stop-name">{name(stop)}</span>
                  <span className="fine-print">
                    {t.reason[stop.reason] ?? ""}
                  </span>
                </span>
                {stopMenu(stop, null)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.canEdit && view.removed.length > 0 && (
        <section className="trip-day" aria-labelledby="removed-stops">
          <h2 id="removed-stops">{t.removedHeading}</h2>
          <ul className="trip-stops">
            {view.removed.map((stop) => (
              <li key={stop.id}>
                <span className="trip-stop-text">
                  <span className="trip-stop-name">{name(stop)}</span>
                </span>
                <button
                  type="button"
                  className="button secondary small"
                  aria-label={t.addBack(name(stop))}
                  disabled={busy}
                  onClick={() => void restore(stop.id)}
                >
                  {t.addBackShort}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="fine-print">{t.limits}</p>

      {view.canDelete && (
        <div className="actions">
          {confirmDelete ? (
            <>
              <span role="alert">{t.confirmDelete}</span>
              <button
                type="button"
                className="button secondary small trip-danger"
                disabled={busy}
                onClick={() => void deleteTrip()}
              >
                {t.confirmDeleteYes}
              </button>
              <button
                type="button"
                className="button secondary small"
                onClick={() => setConfirmDelete(false)}
              >
                {t.cancel}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button secondary small"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={16} aria-hidden="true" />
              {t.deleteTrip}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
