"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  defaultStopsPerDay,
  maxStopsPerDay,
  maxTripDays,
  minStopsPerDay,
} from "@taiwanhub/shared";
import { api } from "@/components/actions";
import { tripCopy } from "@/lib/trip-copy";

type Preview = {
  included: Array<{ itemId: string; label: string; located: boolean }>;
  refused: Array<{ itemId: string; reason: string }>;
};

function span(start: string, end: string) {
  return (
    Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        86_400_000,
    ) + 1
  );
}

/** The new-trip flow in the map panel: name, dates, pace, optional group, and a preview of what gets planned. */
export function NewTripForm({
  locale,
  source,
  group,
  defaultStart,
  defaultEnd,
  onCreated,
}: {
  locale: string;
  /** Opens the created trip on the map. */
  onCreated: (tripId: string) => void;
  source: { kind: "layer" | "folder"; id: string; name: string };
  group: { id: string; name: string } | null;
  defaultStart: string;
  defaultEnd: string;
}) {
  const t = tripCopy(locale);
  const [title, setTitle] = useState(source.name.slice(0, 120));
  const [startsOn, setStartsOn] = useState(defaultStart);
  const [endsOn, setEndsOn] = useState(defaultEnd);
  const [pace, setPace] = useState(defaultStopsPerDay);
  const [asGroup, setAsGroup] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sourceBody =
    source.kind === "layer"
      ? { layerId: source.id }
      : { collectionId: source.id };

  useEffect(() => {
    let live = true;
    api("trips/preview", "POST", {
      ...sourceBody,
      ...(asGroup && group ? { groupId: group.id } : {}),
    })
      .then((p: Preview) => live && setPreview(p))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asGroup, source.id]);

  const days = span(startsOn, endsOn);
  const tooLong = days > maxTripDays;
  const backwards = endsOn < startsOn;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (tooLong || backwards || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await api("trips", "POST", {
        ...sourceBody,
        title: title.trim(),
        startsOn,
        endsOn,
        stopsPerDay: pace,
        ...(asGroup && group ? { groupId: group.id } : {}),
      });
      onCreated(created.trip.id);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(
        code === "NO_PLACES" ? t.noPlaces : (e as Error).message || t.failed,
      );
      setBusy(false);
    }
  };

  const noLocation = preview?.included.filter((p) => !p.located).length ?? 0;
  return (
    <div className="trip-new">
      <p className="muted">{t.fromSource(source.name)}</p>
      <form className="form-panel form-stack" onSubmit={submit}>
        <label>
          {t.titleLabel}
          <input
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="trip-dates">
          <label>
            {t.startLabel}
            <input
              type="date"
              required
              value={startsOn}
              onChange={(e) => {
                setStartsOn(e.target.value);
                if (e.target.value > endsOn) setEndsOn(e.target.value);
              }}
            />
          </label>
          <label>
            {t.endLabel}
            <input
              type="date"
              required
              min={startsOn}
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
          </label>
        </div>
        {tooLong && (
          <p className="message error-message" role="alert">
            {t.maxDays(maxTripDays)}
          </p>
        )}
        <label>
          {t.paceLabel}
          <input
            type="number"
            min={minStopsPerDay}
            max={maxStopsPerDay}
            value={pace}
            onChange={(e) =>
              setPace(
                Math.min(
                  maxStopsPerDay,
                  Math.max(minStopsPerDay, Number(e.target.value) || 0),
                ),
              )
            }
          />
        </label>
        {group && (
          <label className="trip-checkbox">
            <input
              type="checkbox"
              checked={asGroup}
              onChange={(e) => setAsGroup(e.target.checked)}
            />
            {t.groupTripLabel(group.name)}
          </label>
        )}
        {preview && (
          <div className="fine-print" role="status" data-testid="trip-preview">
            <p>{t.previewIncluded(preview.included.length)}</p>
            {noLocation > 0 && <p>{t.previewNoLocation(noLocation)}</p>}
            {preview.refused.length > 0 && (
              <p>
                {t.previewRefused(preview.refused.length)} (
                {[
                  ...new Set(
                    preview.refused.map(
                      (r) => t.refusedReason[r.reason] ?? r.reason,
                    ),
                  ),
                ].join(", ")}
                )
              </p>
            )}
          </div>
        )}
        <p className="fine-print">{t.limits}</p>
        {error && (
          <p className="message error-message" role="alert">
            {error}
          </p>
        )}
        <button
          className="button"
          disabled={
            busy || tooLong || backwards || preview?.included.length === 0
          }
        >
          {busy ? t.creating : t.create}
        </button>
      </form>
    </div>
  );
}
