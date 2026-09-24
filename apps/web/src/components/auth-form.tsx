"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Copy } from "@/lib/i18n";
import { StatusMessage } from "./actions";
import { Field, fieldProps } from "./ui/field";
const client = createAuthClient();
const input = z.object({
  email: z.email(),
  password: z.string().min(10).max(128),
});
/** Existing password/Google members only - no sign-up path here (invite-only, see /join). */
export function AuthForm({
  t,
  next,
  google,
}: {
  t: Copy;
  next: string;
  google: boolean;
}) {
  const [message, setMessage] = useState("");
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof input>>({ resolver: zodResolver(input) });
  const destination =
    next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
      ? next
      : "/";
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
      <h1>{t.signIn}</h1>
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
      <StatusMessage
        feedback={message ? { tone: "error", text: message } : null}
      />
      <p className="auth-links">
        {t.membershipInviteOnly}{" "}
        <Link className="text-button" href="/join">
          {t.askToBeInvited}
        </Link>
      </p>
      <small className="fine-print">{t.privacy}</small>
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
