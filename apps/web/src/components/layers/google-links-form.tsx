"use client";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Link2, Plus, X } from "lucide-react";
import {
  maxGoogleLinks,
  type GoogleLinkReason,
  type GoogleLinkResult,
} from "@taiwanhub/shared";
import { api, StatusMessage } from "@/components/actions";
import { Field, fieldProps } from "@/components/ui/field";
import { ProviderDetails } from "@/components/places/provider-slot";
import { getPlacesProvider } from "@/lib/places/provider";
import { type Copy, type Locale, format } from "@/lib/dictionary";
type Feedback = { tone: "success" | "error"; text: string } | null;
export type ImportOutcome = {
  added: number;
  skipped: { providerPlaceId: string; reason: string }[];
};
function reasonText(reason: GoogleLinkReason | undefined, t: Copy) {
  switch (reason) {
    case "invalid_url":
      return t.linkInvalid;
    case "not_google_maps":
    case "redirect_blocked":
      return t.linkNotGoogleMaps;
    case "list":
      return t.linkList;
    case "no_place_name":
      return t.linkNoPlace;
    case "no_match":
      return t.linkNotFound;
    default:
      return t.linkFailed;
  }
}
/**
 * Paste Google Maps share links, check them, confirm the places they point
 * at, then either create a new layer with them (`create`) or add them to an
 * existing one (`add`). The previews come from the Places UI Kit; only place
 * IDs are sent back to the server.
 */
export function GoogleLinksForm({
  mode,
  layerId,
  city,
  groups = [],
  providerKey,
  t,
  locale,
  onAdded,
}: {
  mode: "create" | "add";
  layerId?: string;
  city: { slug: string; name: string };
  groups?: { id: string; name: string }[];
  providerKey: string | null;
  t: Copy;
  locale: Locale;
  onAdded?: (outcome: ImportOutcome) => void;
}) {
  const router = useRouter();
  const provider = useMemo(
    () => getPlacesProvider(providerKey ?? undefined, locale),
    [providerKey, locale],
  );
  const [text, setText] = useState("");
  const [results, setResults] = useState<GoogleLinkResult[] | null>(null);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [title, setTitle] = useState("");
  const [titleChinese, setTitleChinese] = useState("");
  const [audience, setAudience] = useState<"private" | "group">("private");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // The first result for each place is the one kept; later links to it are duplicates.
  const firstIndex = new Map<string, number>();
  results?.forEach((r, i) => {
    if (r.providerPlaceId && !firstIndex.has(r.providerPlaceId))
      firstIndex.set(r.providerPlaceId, i);
  });
  const chosen = (results ?? [])
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r, i }) =>
        r.status === "resolved" &&
        firstIndex.get(r.providerPlaceId!) === i &&
        !removed.has(i),
    )
    .map(({ r }) => r.providerPlaceId!);
  async function check(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!lines.length) return;
    if (lines.length > maxGoogleLinks) {
      setFeedback({
        tone: "error",
        text: format(t.googleLinksIntro, { max: maxGoogleLinks }),
      });
      return;
    }
    setChecking(true);
    try {
      const data = (await api("google-links/resolve", "POST", {
        links: lines,
      })) as { results: GoogleLinkResult[] };
      setResults(data.results);
      setRemoved(new Set());
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setChecking(false);
    }
  }
  async function submit() {
    if (!chosen.length) return;
    if (mode === "create" && !title.trim()) {
      setFeedback({ tone: "error", text: t.layerTitle });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      if (mode === "create") {
        const created = (await api("layers/from-google", "POST", {
          title: title.trim(),
          titleChinese: titleChinese.trim(),
          city: city.slug,
          audience,
          groupId: audience === "group" ? groupId : undefined,
          providerPlaceIds: chosen,
        })) as { layer: { slug: string } };
        router.push(`/?layers=${encodeURIComponent(created.layer.slug)}`);
        return;
      }
      const outcome = (await api(`layers/${layerId}/google-places`, "POST", {
        providerPlaceIds: chosen,
      })) as ImportOutcome;
      setText("");
      setResults(null);
      setFeedback({
        tone: "success",
        text: [
          format(t.googlePlacesAdded, { added: outcome.added }),
          outcome.skipped.length
            ? format(t.googlePlacesSkipped, { count: outcome.skipped.length })
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
      onAdded?.(outcome);
      router.refresh();
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="google-links form-stack">
      {mode === "create" && (
        <>
          <Field id="google-layer-title" label={t.layerTitle}>
            <input
              {...fieldProps("google-layer-title", {})}
              type="text"
              value={title}
              maxLength={80}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field id="google-layer-title-zh" label={t.chineseName}>
            <input
              id="google-layer-title-zh"
              type="text"
              value={titleChinese}
              maxLength={80}
              onChange={(e) => setTitleChinese(e.target.value)}
            />
          </Field>
          <div className="audience-box">
            <b>{t.reviewAudience}</b>
            {groups.length === 0 ? (
              <p>{t.audiencePrivate}</p>
            ) : (
              <>
                <label className="field-label">
                  <span>
                    <input
                      type="radio"
                      name="google-audience"
                      checked={audience === "private"}
                      onChange={() => setAudience("private")}
                    />{" "}
                    {t.audiencePrivate}
                  </span>
                </label>
                <label className="field-label">
                  <span>
                    <input
                      type="radio"
                      name="google-audience"
                      checked={audience === "group"}
                      onChange={() => setAudience("group")}
                    />{" "}
                    {t.audienceGroup}
                  </span>
                </label>
                {audience === "group" && (
                  <select
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                    aria-label={t.libraryGroups}
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
          </div>
        </>
      )}
      <form className="form-stack" onSubmit={check} noValidate>
        <Field
          id={`google-links-${mode}`}
          label={t.googleLinksLabel}
          help={format(t.googleLinksIntro, { max: maxGoogleLinks })}
        >
          <textarea
            {...fieldProps(`google-links-${mode}`, { help: true })}
            value={text}
            rows={5}
            placeholder="https://maps.app.goo.gl/…"
            onChange={(e) => {
              setText(e.target.value);
              setResults(null);
            }}
          />
        </Field>
        <div className="actions">
          <button
            type="submit"
            className="button secondary"
            disabled={checking || !lines.length}
            aria-busy={checking || undefined}
          >
            <Link2 size={16} aria-hidden="true" />
            {checking ? t.checkingLinks : t.checkLinks}
          </button>
        </div>
      </form>
      {results && (
        <section aria-label={t.googleLinksLabel}>
          <p className="muted" role="status">
            {format(t.linksFound, { count: chosen.length })}
          </p>
          <ul className="google-link-results">
            {results.map((r, i) => {
              const duplicate =
                r.status === "resolved" &&
                firstIndex.get(r.providerPlaceId!) !== i;
              if (removed.has(i)) return null;
              return (
                <li
                  key={i}
                  className={`google-link-result status-${duplicate ? "duplicate" : r.status}`}
                >
                  <span className="fine-print google-link-input">
                    {r.input}
                  </span>
                  {r.status === "resolved" && !duplicate ? (
                    <>
                      {provider && (
                        <ProviderDetails
                          provider={provider}
                          placeId={r.providerPlaceId!}
                          compact
                          onLoad={() => {}}
                          onError={() => {}}
                        />
                      )}
                      {r.name && (
                        <p className="fine-print">
                          {format(t.linkFromName, { name: r.name })}
                        </p>
                      )}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setRemoved((s) => new Set(s).add(i))}
                      >
                        <X size={14} aria-hidden="true" /> {t.removeLink}
                      </button>
                    </>
                  ) : (
                    <p className="message error-message">
                      {duplicate ? t.linkDuplicate : reasonText(r.reason, t)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={saving || !chosen.length}
              aria-busy={saving || undefined}
              onClick={submit}
            >
              <Plus size={16} aria-hidden="true" />
              {saving
                ? t.saving
                : format(
                    mode === "create"
                      ? t.createLayerWithPlaces
                      : t.addGooglePlaces,
                    { count: chosen.length },
                  )}
            </button>
          </div>
        </section>
      )}
      <StatusMessage feedback={feedback} />
    </div>
  );
}
