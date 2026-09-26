"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Copy } from "@/lib/i18n";
import { format } from "@/lib/dictionary";
import { StatusMessage } from "./actions";
import { Field, fieldProps } from "./ui/field";
const client = createAuthClient({ plugins: [emailOTPClient()] });
const input = z.object({
  email: z.email(),
  password: z.string().min(10).max(128),
});
const RESEND_COOLDOWN_SECONDS = 60;
function safeDestination(next: string) {
  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next
    : "/";
}
type Feedback = { tone: "success" | "error"; text: string } | null;
/** Seconds to wait from a rate-limited response, falling back to the resend cooldown. */
function retryAfter(error: object) {
  const value = Number((error as { retryAfter?: unknown }).retryAfter);
  return Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : RESEND_COOLDOWN_SECONDS;
}
function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return [seconds, setSeconds] as const;
}
/**
 * Returning members only - there is no sign-up path here (invite-only; new
 * members join through /join). Email code is the default method; password and
 * Google stay available for members who already use them.
 */
export function AuthForm({
  t,
  next,
  google,
}: {
  t: Copy;
  next: string;
  google: boolean;
}) {
  const [method, setMethod] = useState<"code" | "password">("code");
  const destination = safeDestination(next);
  return (
    <div className="form-stack">
      <h1>{t.signIn}</h1>
      {method === "code" ? (
        <EmailCodeForm t={t} destination={destination} />
      ) : (
        <PasswordForm t={t} destination={destination} />
      )}
      <button
        type="button"
        className="text-button"
        onClick={() => setMethod(method === "code" ? "password" : "code")}
      >
        {method === "code" ? t.signInUsePassword : t.signInUseCode}
      </button>
      {google && (
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            client.signIn.social({
              provider: "google",
              callbackURL: destination,
            })
          }
        >
          {t.google}
        </button>
      )}
      <p className="auth-links">
        {t.membershipInviteOnly}{" "}
        <Link className="text-button" href="/join">
          {t.askToBeInvited}
        </Link>
      </p>
      <small className="fine-print">{t.privacy}</small>
    </div>
  );
}
function EmailCodeForm({ t, destination }: { t: Copy; destination: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"sending" | "verifying" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [cooldown, setCooldown] = useCountdown();
  const codeInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    // Move focus with the step, never on first render.
    if (previousStep.current === step) return;
    previousStep.current = step;
    (step === "code" ? codeInput : emailInput).current?.focus();
  }, [step]);
  async function requestCode() {
    setFeedback(null);
    if (!z.email().safeParse(email.trim()).success) {
      setFeedback({ tone: "error", text: t.authError });
      emailInput.current?.focus();
      return;
    }
    setBusy("sending");
    try {
      const result = await client.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: "sign-in",
      });
      if (result.error) {
        if (result.error.status === 429) {
          const wait = retryAfter(result.error);
          setCooldown(wait);
          setFeedback({
            tone: "error",
            text: format(t.signInCooldown, { seconds: wait }),
          });
        } else {
          setFeedback({ tone: "error", text: t.signInUnavailable });
        }
        return;
      }
      // Same message whether or not the address belongs to a member.
      setCode("");
      setStep("code");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setFeedback({ tone: "success", text: t.signInCodeRequested });
    } catch {
      setFeedback({ tone: "error", text: t.signInUnavailable });
    } finally {
      setBusy(null);
    }
  }
  async function verifyCode() {
    setFeedback(null);
    setBusy("verifying");
    try {
      const result = await client.signIn.emailOtp({
        email: email.trim(),
        otp: code,
      });
      if (result.error) {
        // The server deliberately gives one answer for wrong, expired and
        // exhausted codes; only throttling and outages are distinguished.
        setFeedback({
          tone: "error",
          text:
            result.error.status === 429
              ? t.signInVerifyRateLimited
              : result.error.status >= 500
                ? t.signInUnavailable
                : t.signInCodeInvalid,
        });
        codeInput.current?.focus();
        return;
      }
      router.push(destination);
      router.refresh();
    } catch {
      setFeedback({ tone: "error", text: t.authError });
    } finally {
      setBusy(null);
    }
  }
  if (step === "email")
    return (
      <form
        className="form-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void requestCode();
        }}
      >
        <p className="muted">{t.signInCodeIntro}</p>
        <Field id="auth-code-email" label={t.email}>
          <input
            ref={emailInput}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...fieldProps("auth-code-email", {})}
          />
        </Field>
        <button
          className="button"
          disabled={!!busy || cooldown > 0}
          aria-busy={busy === "sending" || undefined}
        >
          {busy === "sending" ? t.signInSending : t.signInSendCode}
        </button>
        <StatusMessage feedback={feedback} />
      </form>
    );
  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) void verifyCode();
      }}
    >
      <Field id="auth-code" label={t.signInCodeLabel} help={t.signInCodeHelp}>
        <input
          ref={codeInput}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          // Digits only, kept as a string so leading zeroes survive; pasted
          // spaces or dashes are dropped.
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          onPaste={(e) => {
            e.preventDefault();
            setCode(
              e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6),
            );
          }}
          {...fieldProps("auth-code", { help: true })}
          aria-invalid={feedback?.tone === "error" || undefined}
        />
      </Field>
      <button
        className="button"
        disabled={!!busy || code.length !== 6}
        aria-busy={busy === "verifying" || undefined}
      >
        {busy === "verifying" ? t.signInVerifying : t.signIn}
      </button>
      <div className="auth-links">
        <button
          type="button"
          className="text-button"
          disabled={!!busy || cooldown > 0}
          onClick={() => void requestCode()}
        >
          {cooldown > 0
            ? format(t.signInCooldown, { seconds: cooldown })
            : t.signInResend}
        </button>{" "}
        <button
          type="button"
          className="text-button"
          disabled={!!busy}
          onClick={() => {
            setFeedback(null);
            setCode("");
            setStep("email");
          }}
        >
          {t.signInChangeEmail}
        </button>
      </div>
      {/* role=alert for errors, role=status for the generic "code requested" note. */}
      <StatusMessage feedback={feedback} />
    </form>
  );
}
function PasswordForm({ t, destination }: { t: Copy; destination: string }) {
  const [message, setMessage] = useState("");
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof input>>({ resolver: zodResolver(input) });
  return (
    <form
      className="form-stack"
      noValidate
      onSubmit={handleSubmit(async (data) => {
        setMessage("");
        try {
          const result = await client.signIn.email(data);
          if (result.error) {
            setMessage(result.error.message ?? t.authError);
            return;
          }
          router.push(destination);
          router.refresh();
        } catch {
          setMessage(t.authError);
        }
      })}
    >
      <Field id="auth-email" label={t.email} error={errors.email?.message}>
        <input
          type="email"
          autoComplete="email"
          required
          {...register("email")}
          {...fieldProps("auth-email", { error: errors.email?.message })}
        />
      </Field>
      <Field
        id="auth-password"
        label={t.password}
        help={t.passwordHint}
        error={errors.password?.message}
      >
        <input
          type="password"
          autoComplete="current-password"
          required
          minLength={10}
          {...register("password")}
          {...fieldProps("auth-password", {
            help: true,
            error: errors.password?.message,
          })}
        />
      </Field>
      <button
        className="button"
        disabled={isSubmitting}
        aria-busy={isSubmitting || undefined}
      >
        {isSubmitting ? t.submitting : t.signIn}
      </button>
      <StatusMessage
        feedback={message ? { tone: "error", text: message } : null}
      />
    </form>
  );
}
export function SignOut({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="button secondary"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={async () => {
        setBusy(true);
        try {
          await client.signOut();
          router.push("/");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </button>
  );
}
