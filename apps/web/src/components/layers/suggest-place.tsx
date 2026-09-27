"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { placeCategories } from "@taiwanhub/shared";
import { api, StatusMessage } from "@/components/actions";
import { Field } from "@/components/ui/field";
import type { CustomPlace } from "@/features/custom-places/repository";
import type { Copy } from "@/lib/dictionary";
type Feedback = { tone: "success" | "error"; text: string } | null;
/**
 * Opt-in promotion of a private place into the public catalog. A copy goes to
 * the moderation queue; the private place itself never changes visibility.
 */
export function SuggestPlace({
  place,
  t,
  onSuggested,
}: {
  place: CustomPlace;
  t: Copy;
  onSuggested: (place: CustomPlace) => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>(placeCategories[0]);
  const [neighborhood, setNeighborhood] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const located =
    place.locationStatus !== "unspecified" && !!place.address.trim();
  const status =
    place.suggestion === "pending"
      ? t.suggestionPending
      : place.suggestion === "approved"
        ? t.suggestionApproved
        : place.suggestion === "rejected"
          ? t.suggestionRejected
          : null;
  const canSuggest =
    place.suggestion === "none" || place.suggestion === "rejected";
  async function send() {
    if (!neighborhood.trim() || !description.trim()) {
      setFeedback({ tone: "error", text: t.suggestMissing });
      return;
    }
    setSending(true);
    setFeedback(null);
    try {
      const result = (await api(`custom-places/${place.id}/suggest`, "POST", {
        category,
        neighborhood: neighborhood.trim(),
        description: description.trim(),
      })) as { place: CustomPlace };
      setOpen(false);
      onSuggested(result.place);
      setFeedback({ tone: "success", text: t.suggestionSent });
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="suggest-place" aria-labelledby="suggest-heading">
      <h4 id="suggest-heading">{t.suggestToTaiwanHub}</h4>
      {status && <p className="fine-print">{status}</p>}
      <StatusMessage feedback={feedback} />
      {canSuggest && !open && (
        <>
          <p className="fine-print">
            {located ? t.suggestHelp : t.suggestNeedsLocation}
          </p>
          <button
            type="button"
            className="button secondary small"
            disabled={!located}
            onClick={() => setOpen(true)}
          >
            <Send size={14} aria-hidden="true" />
            {t.suggestToTaiwanHub}
          </button>
        </>
      )}
      {canSuggest && open && (
        <div className="form-stack">
          <p className="fine-print">{t.suggestHelp}</p>
          <Field id="suggest-category" label={t.category}>
            <select
              id="suggest-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {placeCategories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="suggest-neighborhood" label={t.neighborhood}>
            <input
              id="suggest-neighborhood"
              type="text"
              value={neighborhood}
              maxLength={80}
              required
              onChange={(e) => setNeighborhood(e.target.value)}
            />
          </Field>
          <Field id="suggest-description" label={t.whyWorthAdding}>
            <textarea
              id="suggest-description"
              value={description}
              maxLength={2000}
              rows={3}
              required
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="actions">
            <button
              type="button"
              className="button small"
              onClick={send}
              disabled={sending}
              aria-busy={sending || undefined}
            >
              {t.sendSuggestion}
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => setOpen(false)}
              disabled={sending}
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
