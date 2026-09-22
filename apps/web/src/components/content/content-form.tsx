"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { api, StatusMessage } from "@/components/actions";
import { Field } from "@/components/ui/field";
import type { Copy } from "@/lib/dictionary";
import type { LocationStatus } from "@taiwanhub/shared";
type Option = { id: string; name: string };
/**
 * General content v1: short text, optional image, optional source link and an
 * optional linked place/event. Location status is explicit; nothing forces a
 * geographic point onto content that has none.
 */
export function ContentForm({
  t,
  city,
  places,
  events,
}: {
  t: Copy;
  city: { slug: string; name: string; timezone: string };
  places: Option[];
  events: Option[];
}) {
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{
    slug: string;
    status: string;
  } | null>(null);
  const [placeId, setPlaceId] = useState("");
  const [eventId, setEventId] = useState("");
  const [status, setStatus] = useState<LocationStatus>("unspecified");
  const linked = !!(placeId || eventId);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    // Absent fields read as null; the API expects strings or nothing.
    const text = (name: string) => String(form.get(name) ?? "");
    setSaving(true);
    setFeedback(null);
    try {
      const post = (await api("content", "POST", {
        title: text("title"),
        titleChinese: text("titleChinese"),
        body: text("body"),
        image: text("image"),
        sourceUrl: text("sourceUrl"),
        placeId: placeId || undefined,
        eventId: eventId || undefined,
        locationStatus: linked ? "exact" : status,
        neighborhood: text("neighborhood"),
        latitude: status === "exact" && !linked ? text("latitude") : undefined,
        longitude:
          status === "exact" && !linked ? text("longitude") : undefined,
        validFrom: text("validFrom")
          ? new Date(text("validFrom")).toISOString()
          : undefined,
        validUntil: text("validUntil")
          ? new Date(text("validUntil")).toISOString()
          : undefined,
        city: city.slug,
      })) as { slug: string; status: string };
      setCreated(post);
      setFeedback({
        tone: "success",
        text: post.status === "approved" ? t.uploaded : t.pending,
      });
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }
  if (created)
    return (
      <div className="form-stack">
        <StatusMessage feedback={feedback} />
        <p className="fine-print">
          {created.status === "approved" ? "" : t.contentPendingNote}
        </p>
        <div className="actions">
          <Link className="button" href={`/content/${created.slug}`}>
            {t.viewContent}
          </Link>
          <Link className="button secondary" href="/">
            {t.mapEntry}
          </Link>
        </div>
      </div>
    );
  return (
    <form className="form-stack" onSubmit={submit}>
      <fieldset className="form-group">
        <legend>{t.basics}</legend>
        <Field id="content-title" label={t.contentTitle}>
          <input
            id="content-title"
            name="title"
            type="text"
            required
            maxLength={120}
          />
        </Field>
        <Field id="content-title-zh" label={t.chineseName}>
          <input
            id="content-title-zh"
            name="titleChinese"
            type="text"
            maxLength={120}
          />
        </Field>
        <Field id="content-body" label={t.contentBody}>
          <textarea
            id="content-body"
            name="body"
            required
            maxLength={2000}
            rows={6}
          />
        </Field>
        <Field id="content-source" label={t.sourceLink}>
          <input
            id="content-source"
            name="sourceUrl"
            type="url"
            placeholder="https://"
          />
        </Field>
        <Field id="content-image" label={t.image}>
          <input
            id="content-image"
            name="image"
            type="url"
            placeholder="https://"
          />
        </Field>
      </fieldset>
      <fieldset className="form-group">
        <legend>{t.locationTime}</legend>
        <div className="form-row">
          <Field id="content-place" label={t.relatedPlace}>
            <select
              id="content-place"
              value={placeId}
              onChange={(e) => {
                setPlaceId(e.target.value);
                if (e.target.value) setEventId("");
              }}
            >
              <option value="">{t.choose}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="content-event" label={t.relatedEvent}>
            <select
              id="content-event"
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                if (e.target.value) setPlaceId("");
              }}
            >
              <option value="">{t.choose}</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {linked ? (
          <p className="field-help">{t.linkedLocationNote}</p>
        ) : (
          <div className="field">
            <span className="field-label">{t.whereApplies}</span>
            {(
              [
                ["unspecified", t.locUnspecified],
                ["approximate", t.locApprox],
                ["citywide", t.locCitywide],
                ["online", t.locOnline],
                ["exact", t.locExact],
              ] as [LocationStatus, string][]
            ).map(([value, label]) => (
              <label key={value} className="radio-row">
                <input
                  type="radio"
                  name="locationStatus"
                  value={value}
                  checked={status === value}
                  onChange={() => setStatus(value)}
                />{" "}
                {label}
              </label>
            ))}
          </div>
        )}
        {!linked && status === "approximate" && (
          <Field id="content-neighborhood" label={t.neighborhood}>
            <input
              id="content-neighborhood"
              name="neighborhood"
              type="text"
              maxLength={80}
            />
          </Field>
        )}
        {!linked && status === "exact" && (
          <div className="form-row">
            <Field id="content-lat" label={t.latitude}>
              <input
                id="content-lat"
                name="latitude"
                type="number"
                step="any"
                min={-90}
                max={90}
                required
              />
            </Field>
            <Field id="content-lng" label={t.longitude}>
              <input
                id="content-lng"
                name="longitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                required
              />
            </Field>
          </div>
        )}
        <div className="form-row">
          <Field id="content-from" label={t.validity} help={t.dateFrom}>
            <input id="content-from" name="validFrom" type="datetime-local" />
          </Field>
          <Field id="content-until" label={t.dateTo}>
            <input id="content-until" name="validUntil" type="datetime-local" />
          </Field>
        </div>
      </fieldset>
      <div className="actions">
        <button
          type="submit"
          className="button"
          disabled={saving}
          aria-busy={saving || undefined}
        >
          {saving ? t.submitting : t.submit}
        </button>
      </div>
      <StatusMessage feedback={feedback} />
    </form>
  );
}
