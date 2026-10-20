"use client";
import { useState, type FormEvent } from "react";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { localDateTimeOf, type LayerEvent } from "@taiwanhub/shared";
import { api, StatusMessage } from "@/components/actions";
import { Field } from "@/components/ui/field";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { eventRange, eventTitle } from "@/lib/event-time";
type Feedback = { tone: "success" | "error"; text: string } | null;
type Draft = {
  id: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  note: string;
};
const empty: Draft = {
  id: null,
  title: "",
  startsAt: "",
  endsAt: "",
  note: "",
};
/**
 * Events attached to one place in a layer: list, add, edit and delete. Times
 * are entered as wall-clock values in the layer city's time zone; the server
 * converts them to instants.
 */
export function LayerItemEvents({
  layerId,
  itemKey,
  itemName,
  events,
  city,
  t,
  locale,
  onChange,
}: {
  layerId: string;
  itemKey: string;
  itemName: string;
  events: LayerEvent[];
  city: { name: string; timezone: string };
  t: Copy;
  locale: Locale;
  onChange: (events: LayerEvent[]) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const id = `events-${itemKey.replace(":", "-")}`;
  const edit = (event: LayerEvent) =>
    setDraft({
      id: event.id,
      title: event.title,
      startsAt: localDateTimeOf(new Date(event.startTime), city.timezone),
      endsAt: localDateTimeOf(new Date(event.endTime), city.timezone),
      note: event.note,
    });
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setPending(true);
    setFeedback(null);
    try {
      const body = {
        title: draft.title.trim(),
        startsAt: draft.startsAt,
        endsAt: draft.endsAt || draft.startsAt,
        note: draft.note.trim(),
      };
      const { event } = (await (draft.id
        ? api(`layers/${layerId}/events/${draft.id}`, "PATCH", body)
        : api(`layers/${layerId}/events`, "POST", {
            ...body,
            key: itemKey,
          }))) as { event: LayerEvent };
      onChange(
        [...events.filter((x) => x.id !== event.id), event].sort((a, b) =>
          a.startTime.localeCompare(b.startTime),
        ),
      );
      setDraft(null);
      setFeedback({ tone: "success", text: t.eventSaved });
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setPending(false);
    }
  }
  async function remove(event: LayerEvent) {
    setPending(true);
    setFeedback(null);
    try {
      await api(`layers/${layerId}/events/${event.id}`, "DELETE");
      onChange(events.filter((x) => x.id !== event.id));
      setFeedback({ tone: "success", text: t.eventDeleted });
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setPending(false);
    }
  }
  return (
    <details className="layer-item-events">
      <summary>
        {t.events} <span className="count-pill">{events.length}</span>
      </summary>
      <h4 className="sr-only">{format(t.eventsFor, { name: itemName })}</h4>
      {events.length === 0 && !draft && (
        <p className="fine-print">{t.noEvents}</p>
      )}
      <ul className="event-list">
        {events.map((event) => (
          <li key={event.id}>
            <span className="event-when">
              {eventRange(event, locale, city.timezone)}
            </span>
            <b>{eventTitle(event, locale)}</b>
            {event.note && <span className="muted">{event.note}</span>}
            <span className="editor-item-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={`${t.editEvent}: ${event.title}`}
                disabled={pending}
                onClick={() => edit(event)}
              >
                <Pencil size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`${t.deleteEvent}: ${event.title}`}
                disabled={pending}
                onClick={() => remove(event)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {draft ? (
        <form className="form-stack event-form" onSubmit={save}>
          <Field id={`${id}-title`} label={t.eventTitle}>
            <input
              id={`${id}-title`}
              type="text"
              value={draft.title}
              maxLength={120}
              required
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Field>
          <div className="form-row">
            <Field id={`${id}-start`} label={t.eventStarts}>
              <input
                id={`${id}-start`}
                type="datetime-local"
                value={draft.startsAt}
                required
                onChange={(e) =>
                  setDraft({ ...draft, startsAt: e.target.value })
                }
              />
            </Field>
            <Field id={`${id}-end`} label={t.eventEnds}>
              <input
                id={`${id}-end`}
                type="datetime-local"
                value={draft.endsAt}
                min={draft.startsAt || undefined}
                onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
              />
            </Field>
          </div>
          <p className="field-help">
            {format(t.eventTimesNote, {
              city: city.name,
              zone: city.timezone,
            })}
          </p>
          <Field id={`${id}-note`} label={t.eventNote}>
            <input
              id={`${id}-note`}
              type="text"
              value={draft.note}
              maxLength={300}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </Field>
          <div className="actions">
            <button
              type="submit"
              className="button small"
              disabled={pending || !draft.title.trim() || !draft.startsAt}
              aria-busy={pending || undefined}
            >
              {pending ? t.saving : t.saveEvent}
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => setDraft(null)}
            >
              {t.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="button secondary small"
          onClick={() => setDraft(empty)}
        >
          <CalendarPlus size={14} aria-hidden="true" /> {t.addEvent}
        </button>
      )}
      <StatusMessage feedback={feedback} />
    </details>
  );
}
