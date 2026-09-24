"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Copy } from "@/lib/dictionary";
import { api, StatusMessage } from "../actions";
import { Field, fieldProps } from "../ui/field";
const input = z.object({
  email: z.email(),
  note: z.string().trim().max(300).optional(),
});
export function NominateForm({
  t,
  defaultEmail,
}: {
  t: Copy;
  defaultEmail?: string;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof input>>({
    resolver: zodResolver(input),
    defaultValues: { email: defaultEmail ?? "" },
  });
  return (
    <form
      className="form-stack"
      onSubmit={handleSubmit(async (data) => {
        setFeedback(null);
        try {
          await api("membership/nominations", "POST", data);
          setFeedback({ tone: "success", text: t.membershipNominated });
          reset();
          router.refresh();
        } catch (e) {
          setFeedback({
            tone: "error",
            text: e instanceof Error ? e.message : t.errorBody,
          });
        }
      })}
    >
      <Field id="nominate-email" label={t.membershipEmailLabel} error={errors.email?.message}>
        <input
          type="email"
          autoComplete="off"
          {...register("email")}
          {...fieldProps("nominate-email", { error: errors.email?.message })}
        />
      </Field>
      <Field id="nominate-note" label={t.membershipNoteLabel} error={errors.note?.message}>
        <textarea
          rows={3}
          maxLength={300}
          {...register("note")}
          {...fieldProps("nominate-note", { error: errors.note?.message })}
        />
      </Field>
      <button className="button" disabled={isSubmitting} aria-busy={isSubmitting || undefined}>
        {isSubmitting ? t.submitting : t.membershipNominateSubmit}
      </button>
      <StatusMessage feedback={feedback} />
    </form>
  );
}
