"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { type Copy, format } from "@/lib/dictionary";
import { api, StatusMessage } from "../actions";
type Nomination = {
  id: string;
  note: string | null;
  revision: number;
  nominatorName: string | null;
  createdAt: string;
};
function ReviewRow({
  t,
  nomination,
  canReject,
}: {
  t: Copy;
  nomination: Nomination;
  canReject: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(decision: "approve" | "needs_info" | "reject") {
    setBusy(true);
    setError("");
    try {
      await api(`membership/nominations/${nomination.id}/decision`, "POST", {
        decision,
        revision: nomination.revision,
        reason: reason.trim() || undefined,
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errorBody);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
      {nomination.nominatorName && (
        <span>{format(t.membershipNominatedBy, { name: nomination.nominatorName })}</span>
      )}
      {nomination.note && <p>{nomination.note}</p>}
      <textarea
        rows={2}
        maxLength={500}
        placeholder={t.membershipReasonLabel}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void decide("approve")}
        >
          {t.membershipApprove}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => void decide("needs_info")}
        >
          {t.membershipAskForInfo}
        </button>
        {canReject && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void decide("reject")}
          >
            {t.membershipReject}
          </button>
        )}
      </div>
      <StatusMessage feedback={error ? { tone: "error", text: error } : null} />
    </li>
  );
}
export function ReviewQueue({
  t,
  nominations,
  canReject,
}: {
  t: Copy;
  nominations: Nomination[];
  canReject: boolean;
}) {
  if (!nominations.length) return <p className="muted">{t.membershipReviewEmpty}</p>;
  return (
    <ul className="settings-rows">
      {nominations.map((n) => (
        <ReviewRow key={n.id} t={t} nomination={n} canReject={canReject} />
      ))}
    </ul>
  );
}
