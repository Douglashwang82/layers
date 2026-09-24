"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { type Copy, format } from "@/lib/dictionary";
import { api, StatusMessage } from "../actions";
type Batch = {
  id: string;
  name: string;
  capacity: number;
  status: string;
  redeemed: number;
  active_issued: number;
};
type Reviewer = {
  user_id: string;
  name: string;
  email: string;
  revoked_at: Date | null;
};
function useApi(t: Copy) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);
  async function run(fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setFeedback(null);
    try {
      await fn();
      if (success) setFeedback({ tone: "success", text: success });
      router.refresh();
    } catch (e) {
      setFeedback({
        tone: "error",
        text: e instanceof Error ? e.message : t.errorBody,
      });
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, feedback };
}
function BatchesPanel({ t, batches }: { t: Copy; batches: Batch[] }) {
  const { run, busy, feedback } = useApi(t);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(20);
  return (
    <section className="form-panel form-stack" aria-labelledby="batches-heading">
      <h2 id="batches-heading">{t.adminBatchesTitle}</h2>
      <ul className="settings-rows">
        {batches.map((b) => (
          <li key={b.id} className="settings-row">
            <span>
              {b.name} · {b.status} ·{" "}
              {format(t.adminBatchUsed, {
                used: b.redeemed + b.active_issued,
                capacity: b.capacity,
              })}
            </span>
            {b.status === "open" && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api(`membership/admin/batches/${b.id}`, "PATCH", {
                      status: "closed",
                    }),
                  )
                }
              >
                {t.adminCloseBatch}
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () =>
              api("membership/admin/batches", "POST", { name, capacity }),
            undefined,
          );
        }}
      >
        <input
          aria-label={t.adminBatchName}
          placeholder={t.adminBatchName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          aria-label={t.adminBatchCapacity}
          type="number"
          min={1}
          max={100000}
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
          required
        />
        <button className="button" disabled={busy}>
          {t.adminCreateBatch}
        </button>
      </form>
      <StatusMessage feedback={feedback} />
    </section>
  );
}
function ReviewersPanel({ t, reviewers }: { t: Copy; reviewers: Reviewer[] }) {
  const { run, busy, feedback } = useApi(t);
  const [email, setEmail] = useState("");
  return (
    <section className="form-panel form-stack" aria-labelledby="reviewers-heading">
      <h2 id="reviewers-heading">{t.adminReviewersTitle}</h2>
      <ul className="settings-rows">
        {reviewers
          .filter((r) => !r.revoked_at)
          .map((r) => (
            <li key={r.user_id} className="settings-row">
              <span>
                {r.name} ({r.email})
              </span>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api(`membership/admin/reviewers/${r.user_id}`, "PUT", {
                      enabled: false,
                    }),
                  )
                }
              >
                {t.adminRevokeReviewer}
              </button>
            </li>
          ))}
      </ul>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(async () => {
            const result = await api(
              `membership/admin/lookup?email=${encodeURIComponent(email)}`,
              "GET",
            ).catch(() => null);
            const userId = (result as { id?: string } | null)?.id;
            if (!userId) throw new Error(t.errorBody);
            await api(`membership/admin/reviewers/${userId}`, "PUT", {
              enabled: true,
            });
          });
          setEmail("");
        }}
      >
        <input
          aria-label={t.adminReviewerEmail}
          type="email"
          placeholder={t.adminReviewerEmail}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button className="button" disabled={busy}>
          {t.adminGrantReviewer}
        </button>
      </form>
      <StatusMessage feedback={feedback} />
    </section>
  );
}
function DirectInvitePanel({ t, batches }: { t: Copy; batches: Batch[] }) {
  const { run, busy, feedback } = useApi(t);
  const openBatch = batches.find((b) => b.status === "open");
  const [email, setEmail] = useState("");
  const [delivery, setDelivery] = useState<"manual" | "email">("manual");
  const [link, setLink] = useState("");
  return (
    <section className="form-panel form-stack" aria-labelledby="direct-invite-heading">
      <h2 id="direct-invite-heading">{t.adminDirectInviteTitle}</h2>
      <p className="muted">{t.adminDirectInviteBody}</p>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!openBatch) return;
          run(async () => {
            const result = (await api("membership/admin/invitations", "POST", {
              email,
              batchId: openBatch.id,
              delivery,
            })) as { delivery: string; link?: string };
            setLink(result.delivery === "manual" ? (result.link ?? "") : "");
            setEmail("");
          });
        }}
      >
        <input
          aria-label={t.adminDirectInviteEmail}
          type="email"
          placeholder={t.adminDirectInviteEmail}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label>
          <input
            type="radio"
            checked={delivery === "manual"}
            onChange={() => setDelivery("manual")}
          />{" "}
          {t.adminDirectInviteManual}
        </label>
        <label>
          <input
            type="radio"
            checked={delivery === "email"}
            onChange={() => setDelivery("email")}
          />{" "}
          {t.adminDirectInviteEmailOption}
        </label>
        <button className="button" disabled={busy || !openBatch}>
          {t.adminDirectInviteSubmit}
        </button>
      </form>
      {link && (
        <div className="notice">
          <p>{t.adminInviteLinkReveal}</p>
          <code>{link}</code>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              navigator.clipboard.writeText(link);
            }}
          >
            {t.copyLink}
          </button>
        </div>
      )}
      <StatusMessage feedback={feedback} />
    </section>
  );
}
export function MembershipAdminPanel({
  t,
  batches,
  reviewers,
}: {
  t: Copy;
  batches: Batch[];
  reviewers: Reviewer[];
}) {
  return (
    <div className="settings-layout">
      <BatchesPanel t={t} batches={batches} />
      <ReviewersPanel t={t} reviewers={reviewers} />
      <DirectInvitePanel t={t} batches={batches} />
    </div>
  );
}
