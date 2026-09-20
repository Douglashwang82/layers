"use client";
import { useState } from "react";
import { api } from "./actions";
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
  const [message, setMessage] = useState("");
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget));
        try {
          await api("profile", "PATCH", data);
          document.cookie = `locale=${data.preferredLanguage};path=/;SameSite=Lax;max-age=31536000`;
          setMessage(t.profileSaved);
        } catch (e) {
          setMessage((e as Error).message);
        }
      }}
    >
      <label>
        {t.name}
        <input name="name" defaultValue={user.name} required maxLength={80} />
      </label>
      <label>
        {t.bio}
        <textarea name="bio" defaultValue={user.bio ?? ""} maxLength={300} />
      </label>
      <label>
        {t.language}
        <select name="preferredLanguage" defaultValue={user.preferredLanguage}>
          <option value="en">English</option>
          <option value="zh-TW">繁體中文</option>
        </select>
      </label>
      <label>
        {t.homeCity}
        <select
          name="homeCityId"
          defaultValue={user.homeCityId ?? cities[0]?.id}
        >
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button className="button">{t.saveChanges}</button>
      <p className="message" role="status">
        {message}
      </p>
    </form>
  );
}
