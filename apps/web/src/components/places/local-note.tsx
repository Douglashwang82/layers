import type { Copy } from "@/lib/dictionary";

export const isUrl = (note: string | null): note is string =>
  !!note && /^https?:\/\/\S+$/.test(note);

/** A layer item's note; imports store the source post's URL here, shown as a link. */
export function LocalNote({ note, t }: { note: string | null; t: Copy }) {
  if (!note) return null;
  if (!isUrl(note)) return <p className="muted">{note}</p>;
  return (
    <p className="fine-print">
      <a href={note} target="_blank" rel="noopener noreferrer">
        {t.sourcePost}
      </a>
    </p>
  );
}
