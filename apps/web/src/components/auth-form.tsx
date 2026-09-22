"use client";
import { useState } from "react";
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
  name: z.string().trim().max(80).optional(),
});
export function AuthForm({
  t,
  next,
  google,
}: {
  t: Copy;
  next: string;
  google: boolean;
}) {
  const [signup, setSignup] = useState(false);
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
          const result = signup
            ? await client.signUp.email({
                ...data,
                name: data.name?.trim() || data.email.split("@")[0],
              })
            : await client.signIn.email(data);
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
      <h1>{signup ? t.signUp : t.signIn}</h1>
      {signup && (
        <Field id="auth-name" label={t.name} error={errors.name?.message}>
          <input
            autoComplete="name"
            {...register("name")}
            {...fieldProps("auth-name", { error: errors.name?.message })}
          />
        </Field>
      )}
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
          autoComplete={signup ? "new-password" : "current-password"}
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
        {isSubmitting ? t.submitting : signup ? t.signUp : t.signIn}
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
        {signup ? t.haveAccount : t.noAccount}{" "}
        <button
          type="button"
          className="text-button"
          onClick={() => setSignup(!signup)}
        >
          {signup ? t.signIn : t.signUp}
        </button>
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
