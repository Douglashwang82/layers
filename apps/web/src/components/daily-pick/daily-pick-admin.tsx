"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AdminDailyPick } from "@/features/daily-pick/service";
import { api } from "@/components/actions";
/**
 * Moderator scheduling: pick a date (today or later) and an eligible place,
 * give an audit reason, optionally a public editorial note. Replacing a
 * published pick sends its id so a concurrent change is refused.
 */
export function DailyPickAdmin({
  city,
  today,
  picks,
  places,
}: {
  city: { slug: string; name: string };
  today: string;
  picks: AdminDailyPick[];
  places: { id: string; name: string; category: string }[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const published = picks.find(
    (p) => p.date === date && p.status === "published",
  );
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(done);
      router.refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run(
      () =>
        api("admin/daily-picks", "POST", {
          city: city.slug,
          date,
          placeId: form.get("placeId"),
          reason: form.get("reason"),
          note: form.get("note"),
          noteChinese: form.get("noteChinese"),
          expectedPickId: published?.id ?? null,
        }),
      published ? "Pick replaced." : "Pick scheduled.",
    );
  }
  return (
    <>
      <p className="muted">
        One shared pick per city and local day ({city.name}, today {today}). The
        daily job fills empty days automatically; an editorial pick is labeled
        as an editorial selection. Past days cannot be rescheduled.
      </p>
      <div className="actions">
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={() =>
            run(
              () =>
                api("admin/daily-picks/generate", "POST", { city: city.slug }),
              "Automatic selection ran for today.",
            )
          }
        >
          Run automatic selection for today
        </button>
      </div>
      <form className="admin-item" onSubmit={schedule}>
        <h2>{published ? "Replace a pick" : "Schedule a pick"}</h2>
        <label>
          Date
          <input
            type="date"
            required
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {published && (
          <p className="notice notice-warning">
            Replaces the published pick for this date: {published.placeName}.
          </p>
        )}
        <label>
          Place
          <select name="placeId" required defaultValue="">
            <option value="" disabled>
              Choose an eligible place
            </option>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name} · {place.category}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reason for the audit log
          <input name="reason" required maxLength={500} />
        </label>
        <label>
          Public note (optional; shown as “Why we picked it”)
          <input name="note" maxLength={280} />
        </label>
        <label>
          Public note in Traditional Chinese (optional)
          <input name="noteChinese" maxLength={280} lang="zh-TW" />
        </label>
        <button type="submit" className="button small" disabled={busy}>
          {published ? "Replace pick" : "Schedule pick"}
        </button>
      </form>
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
      <h2>Recent and scheduled picks</h2>
      {picks.length === 0 && <p>No picks in this period yet.</p>}
      {picks.map((pick) => (
        <article className="admin-item" key={pick.id}>
          <span className="eyebrow">
            {pick.date} · {pick.selectionKind} · {pick.status}
            {!pick.placeVisible && " · place no longer public"}
          </span>
          <h3>{pick.placeName}</h3>
          <p>{pick.reasonText}</p>
          {pick.createdByName && (
            <p className="fine-print">Scheduled by {pick.createdByName}</p>
          )}
          {pick.withdrawalReason && (
            <p className="fine-print">Withdrawn: {pick.withdrawalReason}</p>
          )}
          {pick.status === "published" && (
            <button
              type="button"
              className="button secondary small"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt(
                  "Reason for withdrawing this pick",
                );
                if (reason?.trim())
                  run(
                    () =>
                      api(`admin/daily-picks/${pick.id}/withdraw`, "POST", {
                        reason,
                      }),
                    "Pick withdrawn.",
                  );
              }}
            >
              Withdraw
            </button>
          )}
        </article>
      ))}
    </>
  );
}
