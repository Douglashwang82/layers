"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Star } from "lucide-react";
import { maxReviewBodyLength } from "@taiwanhub/shared";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import type { OwnReview, ReviewScopeSummary } from "@/lib/places/api";
export function scopeLabel(
  scope: Pick<ReviewScopeSummary, "kind" | "title" | "titleChinese">,
  t: Copy,
  locale: Locale,
) {
  const title =
    locale === "zh-TW" && scope.titleChinese ? scope.titleChinese : scope.title;
  return format(
    scope.kind === "layer" ? t.reviewScopeLayer : t.reviewScopeGroup,
    {
      title,
    },
  );
}
export function statusLabel(review: OwnReview, t: Copy) {
  if (review.removedByModerator) return t.reviewRemovedByModerator;
  return {
    pending: t.reviewStatusPending,
    approved: t.reviewStatusApproved,
    rejected: t.reviewStatusRejected,
    hidden: t.reviewStatusHidden,
    deleted: t.reviewStatusDeleted,
  }[review.status];
}
/**
 * Stars (optional, keyboard-accessible radio group with text labels), a plain
 * text comment, and an explicit scope. The draft lives in component memory and
 * survives failures, conflicts and sign-in prompts; it is never stored.
 */
export function ReviewEditor({
  scopes,
  t,
  locale,
  busy,
  onSubmit,
  onDelete,
}: {
  scopes: ReviewScopeSummary[];
  t: Copy;
  locale: Locale;
  busy: boolean;
  onSubmit: (input: {
    scope: string;
    stars: number | null;
    body: string;
    expectedRevision: number | null;
  }) => Promise<boolean>;
  onDelete: (scope: string, expectedRevision: number) => Promise<void>;
}) {
  const id = useId();
  const [scopeKey, setScopeKey] = useState(scopes[0]?.scope ?? "");
  const scope = scopes.find((s) => s.scope === scopeKey) ?? scopes[0];
  const own = scope?.ownReview ?? null;
  const [stars, setStars] = useState<number | null>(own?.stars ?? null);
  const [body, setBody] = useState(own?.body ?? "");
  const [dirty, setDirty] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  // Switching scope loads that scope's own review, unless the member has a draft in progress.
  const ownKey = `${scope?.scope}:${own?.revision ?? 0}`;
  const [loadedKey, setLoadedKey] = useState(ownKey);
  if (loadedKey !== ownKey && !dirty) {
    setLoadedKey(ownKey);
    setStars(own?.status === "deleted" ? null : (own?.stars ?? null));
    setBody(own?.status === "deleted" ? "" : (own?.body ?? ""));
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  if (!scope) return <p className="muted">{t.reviewNoScopes}</p>;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (stars === null && !body.trim()) {
      setHint(t.reviewEmpty);
      return;
    }
    setHint(null);
    const ok = await onSubmit({
      scope: scope.scope,
      stars,
      body: body.trim(),
      expectedRevision: own?.revision ?? null,
    });
    if (ok) setDirty(false);
  };
  return (
    <form className="review-editor" onSubmit={submit}>
      {scopes.length > 1 ? (
        <label>
          {t.reviewScopeLabel}
          <select
            value={scope.scope}
            onChange={(e) => setScopeKey(e.target.value)}
          >
            {scopes.map((s) => (
              <option key={s.scope} value={s.scope}>
                {scopeLabel(s, t, locale)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="fine-print">
          {t.reviewScopeLabel}: {scopeLabel(scope, t, locale)}
        </p>
      )}
      <p className="fine-print">
        {scope.needsModeration ? t.reviewNeedsModeration : t.reviewImmediate}
      </p>
      <fieldset className="star-input">
        <legend>{t.starsLabel}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={stars !== null && n <= stars ? "on" : ""}>
            <input
              type="radio"
              name={`${id}-stars`}
              value={n}
              checked={stars === n}
              onChange={() => {
                setStars(n);
                setDirty(true);
              }}
            />
            <Star size={20} aria-hidden="true" />
            <span className="sr-only">
              {format(t.starsOption, { count: n })}
            </span>
          </label>
        ))}
        <label className="no-stars">
          <input
            type="radio"
            name={`${id}-stars`}
            value=""
            checked={stars === null}
            onChange={() => {
              setStars(null);
              setDirty(true);
            }}
          />
          {t.noStars}
        </label>
      </fieldset>
      <label>
        {t.reviewComment}
        <textarea
          value={body}
          maxLength={maxReviewBodyLength}
          rows={4}
          onChange={(e) => {
            setBody(e.target.value);
            setDirty(true);
          }}
        />
      </label>
      {own && (
        <p className="fine-print" role="status">
          {statusLabel(own, t)}
          {own.status !== "deleted" && ` · ${t.reviewEditNote}`}
        </p>
      )}
      {hint && (
        <p className="message error-message" role="alert">
          {hint}
        </p>
      )}
      <div className="actions">
        <button
          type="submit"
          className="button small"
          disabled={busy || own?.removedByModerator}
        >
          {busy ? t.saving : t.publishOnTaiwanHub}
        </button>
        {own && own.status !== "deleted" && (
          <button
            type="button"
            className="button secondary small"
            disabled={busy}
            onClick={() => onDelete(scope.scope, own.revision)}
          >
            {t.deleteReview}
          </button>
        )}
      </div>
    </form>
  );
}
