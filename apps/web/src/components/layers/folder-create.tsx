"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";
import { api } from "@/components/actions";
import { folderPanelHref } from "@/lib/layer-workspace";
import type { CollectionNode } from "@/features/layers/collections-types";
import type { Copy } from "@/lib/dictionary";

/** "New folder": ask for a name, create it, then open its panel. */
export function FolderCreate({ t, citySlug }: { t: Copy; citySlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = (await api("layer-collections", "POST", {
        title: title.trim(),
        city: citySlug,
        audience: "private",
      })) as CollectionNode;
      window.dispatchEvent(new Event("layer:changed"));
      router.push(folderPanelHref(created.slug, window.location.search), {
        scroll: false,
      });
    } catch (e) {
      setError((e as Error).message || t.folderError);
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button
        type="button"
        className="button secondary"
        onClick={() => setOpen(true)}
      >
        <FolderPlus size={16} aria-hidden="true" />
        {t.folderNew}
      </button>
    );
  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        {t.folderNameLabel}
        <input
          value={title}
          maxLength={120}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <button className="button" disabled={busy || !title.trim()}>
        {t.folderCreate}
      </button>
      <button
        type="button"
        className="button secondary"
        onClick={() => setOpen(false)}
      >
        {t.folderCancel}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
