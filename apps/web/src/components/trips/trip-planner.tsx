"use client";
import { useEffect, useRef, useState } from "react";
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
import { dayColor } from "@/lib/trip-map";
import type {
  TripDayView,
  TripEndpointView,
  TripStopView,
  TripView,
} from "@/features/trips/repository";

type Toast = { stopId: string; name: string } | null;
/** Every change is saved as it is made; this is what the person is told. */
type Save = "idle" | "saving" | "saved" | "failed";

function dateLabel(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * One trip in the map panel: day chips focus the map and the list together,
 * so they always agree. Every change goes to the server, which re-orders only
 * the affected day(s) and returns the new view; a stale revision reloads it.
 * Changes are serialized, so quick keyboard presses never race on a revision.
 */
export function TripPlanner({
  view,
  onView,
  locale,
  focus,
  onFocus,
  selectedStopId,
  onSelectStop,
  mapShown,
  onDeleted,
}: {
  view: TripView;
  onView: (view: TripView) => void;
  locale: string;
  /** A day id, or "all". */
  focus: string;
  onFocus: (focus: string) => void;
  selectedStopId: string | null;
  onSelectStop: (stopId: string | null) => void;
  /** The trip is drawn on the map; otherwise the list says it stands alone. */
  mapShown: boolean;
  onDeleted: () => void;
}) {
  const t = tripCopy(locale);
  const [save, setSave] = useState<Save>("idle");
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The newest view, for requests queued behind a running one.
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  }, [view]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const retry = useRef<(() => Promise<boolean>) | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const undoButton = useRef<HTMLButtonElement>(null);
  const unit = distanceUnit(view.trip.citySlug);
  const distance = (m: number) => formatDistance(m, unit);
  const name = (s: Pick<TripStopView, "label" | "labelChinese">) =>
    (locale === "zh-TW" && s.labelChinese) || s.label || t.unnamed;
  const base = `trips/${view.trip.id}`;

  async function reload() {
    try {
      const next: TripView = await api(base, "GET");
      latest.current = next;
      onView(next);
      return true;
    } catch {
      return false;
    }
  }

  function run(path: string, method: string, body: object = {}) {
    const attempt = async (): Promise<boolean> => {
      setSave("saving");
      setNotice("");
      try {
        const next: TripView = await api(path, method, {
          ...body,
          expectedRevision: latest.current.revision,
        });
        latest.current = next;
        onView(next);
        setSave("saved");
        retry.current = null;
        setCanRetry(false);
        return true;
      } catch (e) {
        const status = (e as { status?: number }).status;
        setSave("failed");
        if (status === 409) {
          // Someone else changed it: show their version, then the person can redo the edit.
          retry.current = null;
          setCanRetry(false);
          setNotice((await reload()) ? t.conflict : t.reloadFailed);
        } else {
          retry.current = attempt;
          setCanRetry(true);
          setNotice((e as Error).message || t.saveFailed);
        }
        return false;
      }
    };
    const result = queue.current.then(attempt);
    queue.current = result.catch(() => false);
    return result;
  }

  useEffect(() => {
    if (toast) undoButton.current?.focus();
  }, [toast]);

  // A pin picked on the map reveals and focuses its row; a row the person
  // used themselves keeps focus where it is.
  useEffect(() => {
    if (!selectedStopId) return;
    const row = document.getElementById(`trip-stop-${selectedStopId}`);
    row?.scrollIntoView({ block: "nearest" });
    if (!row?.contains(document.activeElement))
      row?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [selectedStopId]);

  const remove = async (stop: TripStopView) => {
    if (await run(`${base}/stops/${stop.id}`, "PATCH", { status: "removed" })) {
      if (selectedStopId === stop.id) onSelectStop(null);
      setToast({ stopId: stop.id, name: name(stop) });
    }
  };
  const restore = async (stopId: string) => {
    setToast(null);
    await run(`${base}/stops/${stopId}`, "PATCH", { status: "active" });
  };
  const moveTo = (stop: TripStopView, dayId: string | null) =>
    run(`${base}/stops/${stop.id}`, "PATCH", { dayId });
  const reorder = (day: TripDayView, from: number, to: number) => {
    if (to < 0 || to >= day.stops.length) return;
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
    setDeleting(true);
    setSave("saving");
    setNotice("");
    try {
      await api(base, "DELETE");
      onDeleted();
    } catch (e) {
      setSave("failed");
      setNotice((e as Error).message || t.saveFailed);
      retry.current = null;
      setCanRetry(false);
      setDeleting(false);
    }
  };

  const shown = view.days
    .map((day, index) => ({ day, index }))
    .filter(({ day }) => focus === "all" || focus === day.id);
  const totalStops = view.days.reduce((n, d) => n + d.stops.length, 0);
  const busy = save === "saving";

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
          onClick={() => void remove(stop)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </>
    );

  return (
    <div className="trip-planner">
      <p className="muted trip-subtitle">
        {view.trip.startsOn === view.trip.endsOn
          ? dateLabel(view.trip.startsOn, locale)
          : `${dateLabel(view.trip.startsOn, locale)} – ${dateLabel(view.trip.endsOn, locale)}`}{" "}
        · {view.trip.cityName} · {t.stops(totalStops)} ·{" "}
        {view.trip.audience === "group"
          ? t.groupTrip(view.trip.ownerName)
          : t.privateTrip}
      </p>
      {!view.canEdit && <p className="notice">{t.viewOnly}</p>}

      <p
        className="fine-print trip-save"
        role="status"
        data-state={save}
        data-testid="trip-save"
      >
        {save === "saving" ? t.saving : save === "saved" ? t.saved : ""}
      </p>
      {notice && (
        <p className="message error-message" role="alert">
          {notice}{" "}
          {canRetry ? (
            <button
              type="button"
              className="text-button"
              onClick={() => void retry.current?.()}
            >
              {t.tryAgain}
            </button>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={async () => {
                setNotice((await reload()) ? "" : t.reloadFailed);
              }}
            >
              {t.reloadTrip}
            </button>
          )}
        </p>
      )}
      {toast && (
        <p className="trip-toast" role="status">
          {t.removedToast(toast.name)}{" "}
          <button
            ref={undoButton}
            type="button"
            className="text-button"
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
              onClick={() => void run(`${base}/remove-unavailable`, "POST")}
            >
              {t.removeUnavailable}
            </button>
          )}
        </p>
      )}

      {(view.canEdit || view.base) && (
        <section className="trip-base" aria-labelledby="trip-base-heading">
          <h3 id="trip-base-heading" className="sr-only">
            {t.baseHeading}
          </h3>
          {view.canEdit ? (
            <>
              <div className="trip-base-row">
                <label htmlFor="trip-base-select">{t.baseLabel}</label>
                <select
                  id="trip-base-select"
                  data-testid="trip-base-select"
                  value={view.base?.itemId ?? ""}
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

      <div className="trip-chips" role="group" aria-label={t.daysLabel}>
        <button
          type="button"
          aria-pressed={focus === "all"}
          className={focus === "all" ? "chip on" : "chip"}
          onClick={() => onFocus("all")}
        >
          {t.allDays}
        </button>
        {view.days.map((day, i) => (
          <button
            key={day.id}
            type="button"
            aria-pressed={focus === day.id}
            className={focus === day.id ? "chip on" : "chip"}
            onClick={() => onFocus(day.id)}
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

      <p className="fine-print">{mapShown ? t.legend : t.mapUnavailable}</p>

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
              <h3 id={`day-${day.id}`}>
                <span
                  className="trip-swatch"
                  style={{ background: dayColor(index) }}
                  aria-hidden="true"
                />
                {t.dayHeading(index + 1, dateLabel(day.date, locale))}
              </h3>
              {day.orderMode === "manual" && (
                <span className="trip-badge">{t.yourOrder}</span>
              )}
              {view.canEdit && day.stops.length > 1 && (
                <button
                  type="button"
                  className="text-button"
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
                    <li
                      key={stop.id}
                      id={`trip-stop-${stop.id}`}
                      data-testid="trip-stop"
                      data-selected={stop.id === selectedStopId}
                    >
                      <span
                        className="trip-number"
                        style={{ background: dayColor(index) }}
                        aria-hidden="true"
                      >
                        {i + 1}
                      </span>
                      <span className="trip-stop-text">
                        {stop.location ? (
                          <button
                            type="button"
                            className="trip-stop-name trip-stop-pick"
                            aria-pressed={stop.id === selectedStopId}
                            aria-label={t.showOnMap(name(stop))}
                            onClick={() =>
                              onSelectStop(
                                stop.id === selectedStopId ? null : stop.id,
                              )
                            }
                          >
                            {name(stop)}
                          </button>
                        ) : (
                          <span className="trip-stop-name">{name(stop)}</span>
                        )}
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
                            aria-disabled={i === 0}
                            onClick={() => void reorder(day, i, i - 1)}
                          >
                            <ArrowUp size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={t.moveDown(name(stop))}
                            aria-disabled={i === day.stops.length - 1}
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
                      {t.endsAt(name(day.end))}
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
          <h3 id="not-scheduled">{t.notScheduled}</h3>
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
          <h3 id="removed-stops">{t.removedHeading}</h3>
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
                disabled={deleting}
                onClick={() => void deleteTrip()}
              >
                {deleting ? t.deleting : t.confirmDeleteYes}
              </button>
              <button
                type="button"
                className="button secondary small"
                disabled={deleting}
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
