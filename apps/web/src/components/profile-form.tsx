"use client";
import { useState } from "react";
import { api, StatusMessage } from "./actions";
import { Field } from "./ui/field";
import type { Copy } from "@/lib/i18n";
export function ProfileForm({
  user,
  cities,
  t,
}: {
  user: {
    name: string;
    bio: string | null;
    preferredLanguage: string;
    homeCityId: string | null;
  };
  cities: { id: string; name: string }[];
  t: Copy;
}) {
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget));
        setSaving(true);
        setFeedback(null);
        try {
          await api("profile", "PATCH", data);
          document.cookie = `locale=${data.preferredLanguage};path=/;SameSite=Lax;max-age=31536000`;
          setFeedback({ tone: "success", text: t.profileSaved });
        } catch (e) {
          setFeedback({ tone: "error", text: (e as Error).message });
        } finally {
          setSaving(false);
        }
      }}
    >
      <Field id="profile-name" label={t.name}>
        <input
          id="profile-name"
          name="name"
          defaultValue={user.name}
          required
          maxLength={80}
          autoComplete="nickname"
        />
      </Field>
      <Field id="profile-bio" label={t.bio}>
        <textarea
          id="profile-bio"
          name="bio"
          defaultValue={user.bio ?? ""}
          maxLength={300}
          rows={3}
        />
      </Field>
      <div className="form-row">
        <Field id="profile-language" label={t.language}>
          <select
            id="profile-language"
            name="preferredLanguage"
            defaultValue={user.preferredLanguage}
          >
            <option value="en">English</option>
            <option value="zh-TW">繁體中文</option>
          </select>
        </Field>
        <Field id="profile-city" label={t.homeCity}>
          <select
            id="profile-city"
            name="homeCityId"
            defaultValue={user.homeCityId ?? cities[0]?.id}
          >
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="actions">
        <button
          className="button"
          disabled={saving}
          aria-busy={saving || undefined}
        >
          {saving ? t.saving : t.saveChanges}
        </button>
      </div>
      <StatusMessage feedback={feedback} />
    </form>
  );
}
