"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Copy } from "@/lib/dictionary";
import { api, StatusMessage } from "../actions";
type Nomination = {
  id: string;
  status: string;
  note: string | null;
  revision: number;
  createdAt: string;
};
const statusKey: Record<string, keyof Copy> = {
  pending_review: "membershipStatusPendingReview",
  needs_info: "membershipStatusNeedsInfo",
  approved: "membershipStatusApproved",
  joined: "membershipStatusJoined",
  withdrawn: "membershipStatusWithdrawn",
  rejected: "membershipStatusRejected",
  closed: "membershipStatusClosed",
};
function NominationRow({ t, nomination }: { t: Copy; nomination: Nomination }) {
  const router = useRouter();
  const [note, setNote] = useState(nomination.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canWithdraw =
    nomination.status === "pending_review" || nomination.status === "needs_info";
  return (
    <li className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{t[statusKey[nomination.status] ?? "membershipStatusClosed"]}</span>
      </div>
      {nomination.status === "needs_info" && (
        <div className="form-stack">
          <p className="muted">{t.membershipNeedsInfoNote}</p>
          <textarea
            rows={2}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(`membership/nominations/${nomination.id}`, "PATCH", {
                  note,
                  revision: nomination.revision,
                });
                router.refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : t.errorBody);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t.membershipRespond}
          </button>
        </div>
      )}
      {canWithdraw && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api(`membership/nominations/${nomination.id}/withdraw`, "POST", {
                revision: nomination.revision,
              });
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : t.errorBody);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t.membershipWithdraw}
        </button>
      )}
      <StatusMessage feedback={error ? { tone: "error", text: error } : null} />
    </li>
  );
}
export function MyNominations({ t, nominations }: { t: Copy; nominations: Nomination[] }) {
  if (!nominations.length) return <p className="muted">{t.membershipMineEmpty}</p>;
  return (
    <ul className="settings-rows">
      {nominations.map((n) => (
        <NominationRow key={n.id} t={t} nomination={n} />
      ))}
    </ul>
  );
}
