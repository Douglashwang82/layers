"use client";
import { useEffect, useState } from "react";
import type { restaurantAdminEn } from "@/lib/dictionary";
import { api } from "@/components/actions";
type Area = {
  id: string;
  citySlug: string;
  layerSlug: string;
  timezone: string;
  enabled: boolean;
  configVersion: number;
  candidateCount: number;
  runCount: number;
};
type Candidate = {
  id: string;
  subjectId: string;
  state: string;
  foodType: string | null;
  foodTypeVersion: number | null;
  excludedReason: string | null;
  label: string;
  providerPlaceId: string | null;
  cityReviewStatus: string;
  subjectStatus: string;
  subjectRevision: number;
  evidenceCount: number;
  approvedEvidenceCount: number;
  updatedAt: string;
};
type Run = {
  id: string;
  date: string;
  attempt: number;
  status: string;
  copyStatus: string;
  errorCode: string | null;
  finalPickId: string | null;
  evaluatedCount: number;
  eligibleCount: number;
  excludedCount: number;
  createdAt: string;
};
type ReportRow = {
  subjectId: string;
  label: string;
  baseRank: number;
  eligibleRank: number | null;
  reportPosition: number;
  decision: string;
  score: number | null;
  primaryReasonCode: string;
  reasonCodes: string[];
};
type RunDetail = {
  id: string;
  areaId: string;
  date: string;
  attempt: number;
  status: string;
  copyStatus: string;
  errorCode: string | null;
  finalPickId: string | null;
  currentPickId: string | null;
  report: ReportRow[];
  copy: {
    id: string;
    reviewStatus: string;
    enSentences: { text: string; factIds: string[] }[];
    zhSentences: { text: string; factIds: string[] }[];
    promptVersion: string;
    modelVersion: string;
  } | null;
};
export function RestaurantPicksAdmin({
  areas,
  copy,
  today,
}: {
  areas: Area[];
  copy: typeof restaurantAdminEn;
  today: string;
}) {
  const c = copy;
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [jobs, setJobs] = useState<
    { id: string; kind: string; status: string; result: unknown }[]
  >([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `admin/restaurant-picks/${areaId}`;
  async function refresh() {
    if (!areaId) return;
    const [cs, rs, js] = await Promise.all([
      api(`${base}/candidates`, "GET"),
      api(base, "GET"),
      api(`${base}/jobs`, "GET"),
    ]);
    setCandidates(cs);
    setRuns(rs);
    setJobs(js);
    if (detail)
      setDetail(await api(`admin/restaurant-picks/runs/${detail.id}`, "GET"));
  }
  useEffect(() => {
    let canceled = false;
    setDetail(null);
    if (areaId)
      Promise.all([
        api(`${base}/candidates`, "GET"),
        api(base, "GET"),
        api(`${base}/jobs`, "GET"),
      ])
        .then(([cs, rs, js]) => {
          if (!canceled) {
            setCandidates(cs);
            setRuns(rs);
            setJobs(js);
          }
        })
        .catch((e) => {
          if (!canceled) setMessage(e.message);
        });
    return () => {
      canceled = true;
    };
  }, [areaId, base]);
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await refresh();
      setMessage(c.saved);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function reason(code: string) {
    return (
      c.reasons[code as keyof typeof c.reasons] ?? code.replaceAll("_", " ")
    );
  }
  if (!areas.length) return <p>{c.noAreas}</p>;
  return (
    <section aria-label={c.title}>
      <h2>{c.title}</h2>
      <p>{c.intro}</p>
      <label>
        {c.area}
        <select
          aria-label={c.area}
          value={areaId}
          onChange={(e) => setAreaId(e.target.value)}
        >
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.citySlug}
              {a.enabled ? "" : ` (${c.disabled})`}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <label>
          {c.date}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={busy || !areas.find((a) => a.id === areaId)?.enabled}
          onClick={() => act(() => api(`${base}/prepare`, "POST", { date }))}
        >
          {c.prepare}
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => act(refresh)}
        >
          {c.refresh}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      <h3>{c.jobs}</h3>
      <ul>
        {jobs.map((j) => (
          <li key={j.id}>
            {reason(j.kind)} · {reason(j.status)}
            {j.result ? (
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(j.result)}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
      <h3>{c.runs}</h3>
      <ul>
        {runs.map((r) => (
          <li key={r.id}>
            <button
              className="text-button"
              onClick={() => {
                setBusy(true);
                void api(`admin/restaurant-picks/runs/${r.id}`, "GET")
                  .then(setDetail)
                  .catch((e) => setMessage(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {r.date} #{r.attempt} · {reason(r.status)}
            </button>
          </li>
        ))}
      </ul>
      {detail && (
        <article className="admin-item">
          <h3>
            {c.report} · {detail.date}
          </h3>
          <p>{c.reportHelp}</p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{c.candidate}</th>
                  <th>{c.decision}</th>
                  <th>{c.score}</th>
                  <th>{c.reason}</th>
                </tr>
              </thead>
              <tbody>
                {detail.report.map((r) => (
                  <tr key={r.subjectId}>
                    <td>{r.reportPosition}</td>
                    <td>
                      <a href={`/place-subjects/${r.subjectId}`}>{r.label}</a>
                    </td>
                    <td>{reason(r.decision)}</td>
                    <td>{r.score?.toFixed(2) ?? "—"}</td>
                    <td>
                      {(r.reasonCodes.length
                        ? r.reasonCodes
                        : [r.primaryReasonCode]
                      )
                        .map(reason)
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.copy && (
            <>
              <h3>
                {c.copy} · {reason(detail.copy.reviewStatus)}
              </h3>
              <p lang="en">
                {detail.copy.enSentences.map((s) => s.text).join(" ")}
              </p>
              <p lang="zh-TW">
                {detail.copy.zhSentences.map((s) => s.text).join(" ")}
              </p>
              {detail.copy.reviewStatus === "pending" && (
                <div className="actions">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      act(() =>
                        api(
                          `admin/restaurant-picks/runs/${detail.id}/copy/${detail.copy!.id}/approve`,
                          "POST",
                          {},
                        ),
                      )
                    }
                  >
                    {c.approveCopy}
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt(c.reason);
                      if (reason?.trim())
                        void act(() =>
                          api(
                            `admin/restaurant-picks/runs/${detail.id}/copy/${detail.copy!.id}/reject`,
                            "POST",
                            { reason },
                          ),
                        );
                    }}
                  >
                    {c.reject}
                  </button>
                </div>
              )}
            </>
          )}
          <div className="actions">
            {["ready_for_review", "ready_to_publish"].includes(
              detail.status,
            ) && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  act(() =>
                    api(
                      `admin/restaurant-picks/runs/${detail.id}/cancel`,
                      "POST",
                      {},
                    ),
                  )
                }
              >
                {c.discard}
              </button>
            )}
            {detail.status !== "published" && (
              <button
                className="button"
                disabled={busy || detail.copy?.reviewStatus !== "approved"}
                onClick={() => {
                  if (detail.currentPickId && !window.confirm(c.replace))
                    return;
                  void act(() =>
                    api(
                      `admin/restaurant-picks/runs/${detail.id}/publish`,
                      "POST",
                      { expectedPickId: detail.currentPickId },
                    ),
                  );
                }}
              >
                {c.publish}
              </button>
            )}
            {detail.finalPickId && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt(c.reason);
                  if (reason?.trim())
                    void act(() =>
                      api(
                        `admin/restaurant-picks/picks/${detail.finalPickId}/withdraw`,
                        "POST",
                        { reason },
                      ),
                    );
                }}
              >
                {c.withdraw}
              </button>
            )}
          </div>
        </article>
      )}
      <h3>{c.candidates}</h3>
      {candidates.map((candidate) => (
        <article key={candidate.id} className="admin-item">
          <h4>
            <a href={`/place-subjects/${candidate.subjectId}`}>
              {candidate.label}
            </a>
          </h4>
          <p>
            {reason(candidate.state)} · {candidate.foodType ?? c.unclassified} ·{" "}
            {c.evidence}: {candidate.approvedEvidenceCount}
          </p>
          <p>{candidate.providerPlaceId}</p>
          <div className="actions">
            {candidate.cityReviewStatus !== "approved" && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt(c.areaReason);
                  if (reason?.trim())
                    void act(() =>
                      api(
                        `${base}/candidates/${candidate.id}/confirm-area`,
                        "POST",
                        { expectedRevision: candidate.subjectRevision, reason },
                      ),
                    );
                }}
              >
                {c.confirmArea}
              </button>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                const foodType = window.prompt(
                  c.foodType,
                  candidate.foodType ?? "",
                );
                if (foodType?.trim())
                  void act(() =>
                    api(`${base}/candidates/${candidate.id}`, "PATCH", {
                      expectedUpdatedAt: candidate.updatedAt,
                      foodType,
                      foodTypeVersion: 1,
                    }),
                  );
              }}
            >
              {c.foodType}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                const label = window.prompt(c.fact);
                if (!label?.trim()) return;
                const sourceUrl = window.prompt(c.source);
                if (sourceUrl === null) return;
                void act(() =>
                  api(`${base}/candidates/${candidate.id}/evidence`, "POST", {
                    label,
                    sourceUrl,
                  }),
                );
              }}
            >
              {c.addEvidence}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                act(() =>
                  api(`${base}/candidates/${candidate.id}`, "PATCH", {
                    expectedUpdatedAt: candidate.updatedAt,
                    state: "approved",
                  }),
                )
              }
            >
              {c.approve}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                const excludedReason = window.prompt(c.reason);
                if (excludedReason?.trim())
                  void act(() =>
                    api(`${base}/candidates/${candidate.id}`, "PATCH", {
                      expectedUpdatedAt: candidate.updatedAt,
                      state: "excluded",
                      excludedReason,
                    }),
                  );
              }}
            >
              {c.exclude}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
