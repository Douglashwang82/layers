"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { type Copy, type Locale, dateLabel, format } from "@/lib/dictionary";
import { api, StatusMessage } from "../actions";
import { Field, fieldProps } from "../ui/field";
type ContextInfo = {
  maskedEmail: string;
  nominatorName: string | null;
  invitationExpiresAt: string;
  returnTo?: string;
};
type Step = "code" | "context" | "otp";
function safeDestination(returnTo: string | undefined) {
  return returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
    ? returnTo
    : "/";
}
export function JoinFlow({ t, locale }: { t: Copy; locale: Locale }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [context, setContext] = useState<ContextInfo | null>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoTried, setAutoTried] = useState(false);
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#invite=")) {
      setAutoTried(true);
      return;
    }
    const token = decodeURIComponent(hash.slice("#invite=".length));
    // The token must never reach the server in a URL or referrer; the fragment
    // is stripped immediately and replaced by a POST body.
    window.history.replaceState(null, "", window.location.pathname);
    startContext(token).finally(() => setAutoTried(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function startContext(token: string) {
    setError("");
    setBusy(true);
    try {
      const result = (await api("membership/join/context", "POST", {
        token,
      })) as ContextInfo;
      setContext(result);
      setStep("context");
    } catch {
      setError(t.joinInvalid);
    } finally {
      setBusy(false);
    }
  }
  async function sendOtp() {
    setError("");
    setBusy(true);
    try {
      await api("membership/join/email/start", "POST", { acceptTerms: true });
      setStep("otp");
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(
        code === "RATE_LIMITED"
          ? t.joinRateLimited
          : code === "MAIL_UNAVAILABLE"
            ? t.joinSendFailed
            : t.joinInvalid,
      );
    } finally {
      setBusy(false);
    }
  }
  async function completeOtp() {
    setError("");
    setBusy(true);
    try {
      await api("membership/join/email/complete", "POST", { otp });
      router.push(safeDestination(context?.returnTo));
      router.refresh();
    } catch {
      setError(t.joinOtpInvalid);
    } finally {
      setBusy(false);
    }
  }
  if (!autoTried) return null;
  return (
    <div className="form-panel form-stack">
      <h1>{t.joinTitle}</h1>
      {step === "code" && (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void startContext(code.trim());
          }}
        >
          <Field id="join-code" label={t.joinCodeLabel} help={t.joinCodeHelp}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              {...fieldProps("join-code", { help: true })}
            />
          </Field>
          <button className="button" disabled={busy || !code.trim()}>
            {t.joinCodeSubmit}
          </button>
        </form>
      )}
      {step === "context" && context && (
        <div className="form-stack">
          <p>
            {context.nominatorName
              ? format(t.joinInvitedBy, { name: context.nominatorName })
              : context.maskedEmail}
          </p>
          <p className="muted">
            {format(t.joinExpiresOn, {
              date: dateLabel(context.invitationExpiresAt, locale),
            })}
          </p>
          <p className="fine-print">{t.joinCommunityNote}</p>
          <button
            className="button"
            disabled={busy}
            onClick={() => void sendOtp()}
          >
            {t.joinAccept}
          </button>
        </div>
      )}
      {step === "otp" && context && (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (otp.trim()) void completeOtp();
          }}
        >
          <p>{format(t.joinOtpSent, { email: context.maskedEmail })}</p>
          <Field id="join-otp" label={t.joinOtpLabel}>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              maxLength={6}
              // Digits only, as a string so leading zeroes survive a paste.
              onChange={(e) =>
                setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              {...fieldProps("join-otp", {})}
            />
          </Field>
          <button className="button" disabled={busy || !otp.trim()}>
            {t.joinOtpSubmit}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void sendOtp()}
          >
            {t.joinOtpResend}
          </button>
        </form>
      )}
      <StatusMessage feedback={error ? { tone: "error", text: error } : null} />
    </div>
  );
}
