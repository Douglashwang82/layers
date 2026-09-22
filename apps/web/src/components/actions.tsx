"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Bookmark, Check, Share2 } from "lucide-react";
import type { Copy } from "@/lib/i18n";
import type { Kind } from "@taiwanhub/shared";
export async function api(path: string, method = "POST", body: unknown = {}) {
  const response = await fetch("/api/v1/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "DELETE" || method === "GET"
      ? {}
      : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Request failed");
  return result.data;
}
export type EventState = "open" | "full" | "cancelled" | "postponed" | "ended";
type Pending = "save" | "rsvp" | "follow" | "yes" | "no";
type Feedback = { tone: "success" | "error"; text: string };
export function StatusMessage({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  return (
    <p
      role={feedback.tone === "error" ? "alert" : "status"}
      className={`message ${feedback.tone === "error" ? "error-message" : "success-message"}`}
    >
      {feedback.text}
    </p>
  );
}
/**
 * One mutation controller for a detail page. Tracks which action is pending so
 * the button can say what it is doing, keeps drafts on failure, and stays busy
 * until the refreshed authoritative state has arrived.
 */
export function DetailActions({
  kind,
  id,
  authenticated,
  state,
  t,
  eventState = "open",
  primary,
}: {
  kind: Kind;
  id: string;
  authenticated: boolean;
  state: {
    saved: boolean;
    going: boolean;
    following: boolean;
    vote: boolean | null;
  };
  t: Copy;
  eventState?: EventState;
  /** Kind-specific main action rendered by the server (directions, “I found this”). */
  primary?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState<Pending | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [shareFeedback, setShareFeedback] = useState<Feedback | null>(null);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const busy = pending !== null || refreshing;
  async function perform(
    label: Pending,
    action: string,
    method = "POST",
    body: unknown = {},
  ) {
    if (!authenticated) {
      router.push("/sign-in?next=" + encodeURIComponent(pathname));
      return;
    }
    setPending(label);
    setFeedback(null);
    try {
      await api(`${kind}/${id}/${action}`, method, body);
      if (label === "yes" || label === "no") {
        // The vote itself is applied; an accompanying note still awaits moderation.
        if (note.trim()) setFeedback({ tone: "success", text: t.pending });
        setNote("");
        setNoteOpen(false);
      }
      startRefresh(() => router.refresh());
    } catch (e) {
      setFeedback({ tone: "error", text: (e as Error).message });
    } finally {
      setPending(null);
    }
  }
  const recommend = (positive: boolean) =>
    perform(positive ? "yes" : "no", "recommendation", "POST", {
      positive,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  const rsvpBlocked = eventState !== "open" && !state.going;
  return (
    <>
      <div className="actions">
        {primary}
        {kind === "events" && (
          <button
            type="button"
            className={`button ${state.going ? "active" : ""}`}
            disabled={busy || rsvpBlocked}
            aria-busy={pending === "rsvp" || undefined}
            onClick={() =>
              perform("rsvp", "rsvp", state.going ? "DELETE" : "POST")
            }
          >
            <Check size={16} aria-hidden="true" />
            {pending === "rsvp"
              ? t.updating
              : state.going
                ? t.cancelRsvp
                : eventState === "full"
                  ? t.full
                  : eventState !== "open"
                    ? t.rsvpUnavailable
                    : t.rsvp}
          </button>
        )}
        {kind === "organizations" && (
          <button
            type="button"
            className={`button ${state.following ? "active" : ""}`}
            disabled={busy}
            aria-busy={pending === "follow" || undefined}
            onClick={() =>
              perform("follow", "follow", state.following ? "DELETE" : "POST")
            }
          >
            {pending === "follow"
              ? t.updating
              : state.following
                ? t.unfollow
                : t.follow}
          </button>
        )}
        {kind !== "organizations" && (
          <button
            type="button"
            disabled={busy}
            aria-busy={pending === "save" || undefined}
            className={`button secondary ${state.saved ? "active" : ""}`}
            onClick={() =>
              perform("save", "save", state.saved ? "DELETE" : "POST")
            }
          >
            <Bookmark size={16} aria-hidden="true" />
            {pending === "save" ? t.saving : state.saved ? t.unsave : t.save}
          </button>
        )}
        <button
          type="button"
          className="button secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              setShareFeedback({ tone: "success", text: t.copied });
            } catch {
              setShareFeedback({ tone: "error", text: t.shareFailed });
            }
          }}
        >
          <Share2 size={16} aria-hidden="true" />
          {t.share}
        </button>
      </div>
      {rsvpBlocked && eventState !== "full" && (
        <p className="fine-print">
          {eventState === "cancelled"
            ? t.eventCancelled
            : eventState === "postponed"
              ? t.eventPostponed
              : t.eventEnded}
        </p>
      )}
      <StatusMessage feedback={shareFeedback} />
      {kind !== "places" && <StatusMessage feedback={feedback} />}
      {kind === "places" && (
        <section className="recommend-box" aria-labelledby="recommend-heading">
          <h3 id="recommend-heading">{t.recommend}</h3>
          <div className="actions">
            <button
              type="button"
              disabled={busy}
              aria-busy={pending === "yes" || undefined}
              aria-pressed={state.vote === true}
              className={`button ${state.vote === true ? "active" : ""}`}
              onClick={() => recommend(true)}
            >
              {pending === "yes" ? t.submitting : t.yes}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-busy={pending === "no" || undefined}
              aria-pressed={state.vote === false}
              className={`button secondary ${state.vote === false ? "active" : ""}`}
              onClick={() => recommend(false)}
            >
              {pending === "no" ? t.submitting : t.no}
            </button>
          </div>
          {noteOpen || note ? (
            <label className="field-label" htmlFor="note">
              {t.note}
              <textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                rows={3}
                autoFocus
                disabled={busy}
                aria-describedby="note-help"
              />
            </label>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={() => setNoteOpen(true)}
            >
              {t.addNote}
            </button>
          )}
          <p className="fine-print" id="note-help">
            {t.fixedNoteHelp}
          </p>
          <StatusMessage feedback={feedback} />
        </section>
      )}
    </>
  );
}
export function ReportButton({
  kind,
  id,
  t,
}: {
  kind: string;
  id: string;
  t: Copy;
}) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [sending, setSending] = useState(false);
  return (
    <div className="report">
      <button
        type="button"
        className="text-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t.report}
      </button>
      {open && (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setSending(true);
            try {
              await api("reports", "POST", {
                entityType: kind,
                entityId: id,
                reason: form.get("reason"),
              });
              setFeedback({ tone: "success", text: t.reportSent });
              setOpen(false);
            } catch (e) {
              setFeedback({ tone: "error", text: (e as Error).message });
            } finally {
              setSending(false);
            }
          }}
        >
          <label>
            {t.reason}
            <textarea name="reason" required maxLength={500} rows={3} />
          </label>
          <button
            className="button secondary small"
            disabled={sending}
            aria-busy={sending || undefined}
          >
            {sending ? t.submitting : t.submit}
          </button>
        </form>
      )}
      <StatusMessage feedback={feedback} />
    </div>
  );
}
