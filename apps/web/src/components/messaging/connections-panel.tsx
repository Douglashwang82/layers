"use client";
import { useState } from "react";
import { api, StatusMessage } from "../actions";
import { Field } from "../ui/field";
import { messagingEn, messagingZh } from "@/lib/messaging-copy";
type Channel = "line" | "instagram";
export type ConnectionsData = {
  connections: {
    channel: Channel;
    configured: boolean;
    chatUrl: string | null;
    status: "none" | "pending_confirm" | "active";
    defaultLayerId: string | null;
  }[];
  layers: {
    id: string;
    title: string;
    titleChinese: string;
    audience: string;
  }[];
  recent: {
    channel: Channel;
    sourceUrl: string | null;
    outcome: string;
    added: number;
    receivedAt: string;
    layerTitle: string | null;
    layerSlug: string | null;
  }[];
};
type Feedback = { tone: "success" | "error"; text: string };
/** Connect LINE/Instagram, confirm, choose the destination layer, see recent sends. */
export function ConnectionsPanel({
  locale,
  initial,
}: {
  locale: "en" | "zh-TW";
  initial: ConnectionsData;
}) {
  const t = locale === "zh-TW" ? messagingZh : messagingEn;
  const [data, setData] = useState(initial);
  const [codes, setCodes] = useState<Partial<Record<Channel, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const title = (l: { title: string; titleChinese: string }) =>
    locale === "zh-TW" && l.titleChinese ? l.titleChinese : l.title;
  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setFeedback(null);
    try {
      await fn();
      setData(await api("messaging/connections", "GET"));
      if (done) setFeedback({ tone: "success", text: done });
    } catch (e) {
      setFeedback({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="messaging-connections">
      <StatusMessage feedback={feedback} />
      {data.connections.map((c) => {
        const app = t[c.channel];
        const code = codes[c.channel];
        const statusText =
          c.status === "active"
            ? t.connected
            : c.status === "pending_confirm"
              ? t.pending
              : t.notConnected;
        const selected = data.layers.find((l) => l.id === c.defaultLayerId);
        return (
          <section
            key={c.channel}
            className="form-panel messaging-channel"
            aria-labelledby={`messaging-${c.channel}`}
          >
            <h2 id={`messaging-${c.channel}`}>
              {app}{" "}
              <span className="messaging-status" data-status={c.status}>
                {c.configured ? statusText : t.notConfigured}
              </span>
            </h2>
            {c.configured && c.status !== "active" && (
              <div className="messaging-connect">
                {code && c.status === "none" && (
                  <>
                    <p>{t.codeHelp(app)}</p>
                    <p
                      className="messaging-code"
                      data-testid={`messaging-code-${c.channel}`}
                    >
                      {code}
                    </p>
                    {c.chatUrl && (
                      <p>
                        <a
                          href={c.chatUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t.openChat(app)}
                        </a>
                      </p>
                    )}
                  </>
                )}
                {c.status === "pending_confirm" && (
                  <>
                    <p>{t.pendingHelp}</p>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        run(`confirm-${c.channel}`, () =>
                          api(
                            `messaging/connections/${c.channel}/confirm`,
                            "POST",
                          ),
                        )
                      }
                    >
                      {busy === `confirm-${c.channel}`
                        ? t.working
                        : `${t.confirm} ${app}`}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={
                    code || c.status !== "none" ? "secondary" : undefined
                  }
                  disabled={busy !== null}
                  onClick={() =>
                    run(`code-${c.channel}`, async () => {
                      if (c.status === "pending_confirm")
                        await api(
                          `messaging/connections/${c.channel}`,
                          "DELETE",
                        );
                      const result = await api(
                        `messaging/connections/${c.channel}/code`,
                        "POST",
                      );
                      setCodes((all) => ({ ...all, [c.channel]: result.code }));
                    })
                  }
                >
                  {busy === `code-${c.channel}`
                    ? t.working
                    : code || c.status !== "none"
                      ? t.newCode
                      : `${t.connect} ${app}`}
                </button>
              </div>
            )}
            {c.status === "active" && (
              <div className="form-stack">
                <Field
                  id={`messaging-destination-${c.channel}`}
                  label={t.destination}
                  help={
                    selected?.audience === "group" ? t.groupWarning : undefined
                  }
                >
                  <select
                    id={`messaging-destination-${c.channel}`}
                    value={c.defaultLayerId ?? ""}
                    disabled={busy !== null}
                    onChange={(e) =>
                      run(
                        `destination-${c.channel}`,
                        () =>
                          api(`messaging/connections/${c.channel}`, "PATCH", {
                            defaultLayerId: e.target.value || null,
                          }),
                        t.saved,
                      )
                    }
                  >
                    <option value="">{t.inbox}</option>
                    {data.layers.map((l) => (
                      <option key={l.id} value={l.id}>
                        {title(l)} ·{" "}
                        {l.audience === "group" ? t.groupLayer : t.privateLayer}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy !== null}
                  onClick={() =>
                    run(`disconnect-${c.channel}`, () =>
                      api(`messaging/connections/${c.channel}`, "DELETE"),
                    )
                  }
                >
                  {t.disconnect} {app}
                </button>
              </div>
            )}
          </section>
        );
      })}
      <section className="form-panel" aria-labelledby="messaging-recent">
        <h2 id="messaging-recent">{t.recent}</h2>
        {data.recent.length ? (
          <ul className="messaging-recent">
            {data.recent.map((r, i) => (
              <li key={i}>
                <span className="messaging-via">{t[r.channel]}</span>
                {" · "}
                {t.outcome[r.outcome] ?? r.outcome}
                {r.layerTitle && r.layerSlug && (
                  <>
                    {" · "}
                    <a
                      href={`/?layerPanel=detail&layer=${encodeURIComponent(r.layerSlug)}`}
                    >
                      {r.layerTitle}
                    </a>
                  </>
                )}
                <br />
                <small className="messaging-url">{r.sourceUrl}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t.recentEmpty}</p>
        )}
      </section>
    </div>
  );
}
