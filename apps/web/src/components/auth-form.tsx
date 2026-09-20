"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Copy } from "@/lib/i18n";
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
        <label>
          {t.name}
          <input autoComplete="name" {...register("name")} required />
        </label>
      )}
      <label>
        {t.email}
        <input
          type="email"
          autoComplete="email"
          {...register("email")}
          required
        />
      </label>
      <label>
        {t.password}
        <input
          aria-label={t.password}
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          {...register("password")}
          required
          minLength={10}
        />
        <small>{t.passwordHint}</small>
      </label>
      {Object.values(errors).map((e, i) => (
        <p className="error-message" key={i}>
          {e.message}
        </p>
      ))}
      <button className="button" disabled={isSubmitting}>
        {signup ? t.signUp : t.signIn}
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
      <p className="message error-message" role="alert">
        {message}
      </p>
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
  return (
    <button
      className="button secondary"
      onClick={async () => {
        await client.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
