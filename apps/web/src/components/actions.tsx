"use client";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Bookmark, Check, Share2 } from "lucide-react";
import type { Copy } from "@/lib/i18n";
import type { Kind } from "@taiwanhub/shared";
export async function api(path: string, method = "POST", body: unknown = {}) {
  const response = await fetch("/api/v1/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Request failed");
  return result.data;
}
export function DetailActions({
  kind,
  id,
  authenticated,
  state,
  t,
  full = false,
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
  full?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [note, setNote] = useState("");
  async function perform(action: string, method = "POST", body: unknown = {}) {
    if (!authenticated) {
      router.push("/sign-in?next=" + encodeURIComponent(pathname));
      return;
    }
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      await api(`${kind}/${id}/${action}`, method, body);
      setNote("");
      if (action === "recommendation" && note) setMessage(t.pending);
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="actions">
        {kind !== "organizations" && (
          <button
            disabled={busy}
            className={`button secondary ${state.saved ? "active" : ""}`}
            onClick={() => perform("save", state.saved ? "DELETE" : "POST")}
          >
            <Bookmark size={15} />
            {state.saved ? t.unsave : t.save}
          </button>
        )}
        {kind === "events" && (
          <button
            className={`button ${state.going ? "active" : ""}`}
            disabled={busy || (full && !state.going)}
            onClick={() => perform("rsvp", state.going ? "DELETE" : "POST")}
          >
            <Check size={15} />
            {state.going ? t.cancelRsvp : full ? t.full : t.rsvp}
          </button>
        )}
        {kind === "organizations" && (
          <button
            disabled={busy}
            className="button dark"
            onClick={() =>
              perform("follow", state.following ? "DELETE" : "POST")
            }
          >
            {state.following ? t.unfollow : t.follow}
          </button>
        )}
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              setMessage(t.copied);
            } catch {
              setMessage(window.location.href);
            }
          }}
        >
          <Share2 size={15} />
          {t.share}
        </button>
      </div>
      {kind === "places" && (
        <div className="recommend-box">
          <h3>{t.recommend}</h3>
          <label className="sr-only" htmlFor="note">
            {t.note}
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder={t.note}
          />
          <div className="actions">
            <button
              disabled={busy}
              aria-pressed={state.vote === true}
              className={`button ${state.vote === true ? "active" : ""}`}
              onClick={() =>
                perform("recommendation", "POST", {
                  positive: true,
                  ...(note ? { note } : {}),
                })
              }
            >
              {t.yes}
            </button>
            <button
              disabled={busy}
              aria-pressed={state.vote === false}
              className={`button secondary ${state.vote === false ? "active" : ""}`}
              onClick={() =>
                perform("recommendation", "POST", {
                  positive: false,
                  ...(note ? { note } : {}),
                })
              }
            >
              {t.no}
            </button>
          </div>
          <p className="fine-print">{t.notesPending}</p>
        </div>
      )}
      {message && (
        <p role="status" className={`message ${error ? "error-message" : ""}`}>
          {message}
        </p>
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
  const [message, setMessage] = useState("");
  return (
    <div>
      <button className="text-button" onClick={() => setOpen(!open)}>
        {t.report}
      </button>
      {open && (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            try {
              await api("reports", "POST", {
                entityType: kind,
                entityId: id,
                reason: form.get("reason"),
              });
              setMessage(t.reportSent);
              setOpen(false);
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          <label>
            {t.reason}
            <textarea name="reason" required maxLength={500} />
          </label>
          <button className="button">{t.submit}</button>
        </form>
      )}
      <p role="status" className="message">
        {message}
      </p>
    </div>
  );
}
