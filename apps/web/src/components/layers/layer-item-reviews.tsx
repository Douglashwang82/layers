"use client";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Star } from "lucide-react";
import { maxReviewBodyLength } from "@taiwanhub/shared";
import { StatusMessage } from "@/components/actions";
import { statusLabel } from "@/components/places/review-editor";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { ApiError, subjectApi, type OwnReview } from "@/lib/places/api";

type Summary = {
  totalReviews: number;
  ratedCount: number;
  averageStars: number | null;
};
type ItemReview = {
  id: string;
  author: { name: string; image: string | null };
  stars: number | null;
  body: string;
  updatedAt: string;
  mine: boolean;
};
type ItemOwn = Omit<OwnReview, "scope">;
type ReviewPage = {
  summary: Summary;
  reviews: ItemReview[];
  nextCursor: string | null;
  own: ItemOwn | null;
  canReview: boolean;
};
type Ratings = Record<
  string,
  { averageStars: number | null; ratedCount: number }
>;
type Feedback = { tone: "success" | "error"; text: string } | null;

/** Fired after a review write; listeners refetch ratings and previews. */
export const reviewsChangedEvent = "layer:item-reviews";
const changed = reviewsChangedEvent;
type LayerData = [
  { ratings: Ratings },
  { items: { id: string; key: string; markerImageUrl?: string | null }[] },
];
/** Rows of one layer share one request pair; entries expire so a stale view never outlives the TTL. */
const cacheTtlMs = 30_000;
const shared = new Map<
  string,
  { startedAt: number; pending: Promise<LayerData> }
>();

/**
 * `since` is the timestamp of the review-change event being handled: a cached
 * request started at or after it already reflects that change, so the many
 * hooks reacting to one event trigger a single refetch.
 */
function fetchLayerData(layerId: string, since: number | null) {
  const now = performance.now();
  const hit = shared.get(layerId);
  if (
    hit &&
    now - hit.startedAt < cacheTtlMs &&
    (since === null || hit.startedAt >= since)
  )
    return hit.pending;
  const pending = Promise.all([
    subjectApi<{ ratings: Ratings }>(`layers/${layerId}/item-ratings`),
    subjectApi<{
      items: { id: string; key: string; markerImageUrl?: string | null }[];
    }>(`layers/${layerId}/items?order=1`),
  ]);
  const entry = { startedAt: now, pending };
  shared.set(layerId, entry);
  pending.catch(() => {
    if (shared.get(layerId) === entry) shared.delete(layerId);
  });
  return pending;
}

/** Item ids by row key. When keys collide (a place and a custom place resolving alike) the lowest id wins. */
export function itemIdsByKey(items: { id: string; key: string }[]) {
  const ids = new Map<string, string>();
  for (const { id, key } of items) {
    const current = ids.get(key);
    if (current === undefined || id < current) ids.set(key, id);
  }
  return ids;
}

/**
 * Layer item ids (the review API addresses items by id, rows by key) plus the
 * per-item rating summaries. `available` is false once an endpoint 404s, so the
 * review UI hides itself where the backend is not deployed.
 */
export function useLayerItemRatings(layerId: string | undefined) {
  const [state, setState] = useState<{
    ids: Map<string, string>;
    ratings: Ratings;
    /** Custom marker image URL by item id. */
    markers: Map<string, string>;
    available: boolean | null;
  }>({ ids: new Map(), ratings: {}, markers: new Map(), available: null });
  const load = useCallback(
    async (since: number | null) => {
      if (!layerId) return;
      try {
        const [ratings, items] = await fetchLayerData(layerId, since);
        setState({
          ids: itemIdsByKey(items.items),
          ratings: ratings.ratings,
          markers: new Map(
            items.items.flatMap((i) =>
              i.markerImageUrl ? [[i.id, i.markerImageUrl] as const] : [],
            ),
          ),
          available: true,
        });
      } catch {
        setState((s) => ({ ...s, available: false }));
      }
    },
    [layerId],
  );
  useEffect(() => {
    const reload = (e: Event) => void load(e.timeStamp);
    // Loads once on mount and again whenever a review changes.
    void load(null);
    window.addEventListener(changed, reload);
    return () => window.removeEventListener(changed, reload);
  }, [load]);
  return state;
}

function Stars({ value, t }: { value: number; t: Copy }) {
  return (
    <span
      className="review-stars"
      role="img"
      aria-label={format(t.starsOption, { count: value })}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          aria-hidden="true"
          fill={n <= value ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

/** Compact average and count for a contents row; renders nothing without ratings. */
export function LayerItemRatingBadge({
  rating,
  t,
}: {
  rating: Ratings[string] | undefined;
  t: Copy;
}) {
  if (!rating || rating.averageStars === null || rating.ratedCount === 0)
    return null;
  const average = rating.averageStars.toFixed(1);
  return (
    <span
      className="rating-line"
      role="img"
      aria-label={format(t.itemRatingBadge, {
        average,
        count: rating.ratedCount,
      })}
    >
      <Star size={13} aria-hidden="true" fill="currentColor" /> {average} (
      {rating.ratedCount})
    </span>
  );
}

/**
 * Ratings and comments for one layer item: summary, others' comments, and the
 * member's own add/edit/delete form. Read-only when signed out or when the
 * server says the viewer cannot review. Hidden if the endpoint is missing.
 */
export function LayerItemReviews({
  layerId,
  itemId,
  itemName,
  t,
  locale,
}: {
  layerId: string;
  itemId: string;
  itemName: string;
  t: Copy;
  locale: Locale;
}) {
  const base = `layers/${layerId}/items/${itemId}`;
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ReviewPage | null>(null);
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await subjectApi<ReviewPage>(`${base}/reviews`));
      setFailed(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setHidden(true);
      else setFailed(true);
    }
  }, [base]);
  useEffect(() => {
    if (!open || data) return;
    // First open loads the first page.
    void load();
  }, [open, data, load]);

  const more = async () => {
    if (!data?.nextCursor) return;
    try {
      const next = await subjectApi<ReviewPage>(
        `${base}/reviews?cursor=${encodeURIComponent(data.nextCursor)}`,
      );
      setData({
        ...data,
        reviews: [...data.reviews, ...next.reviews],
        nextCursor: next.nextCursor,
      });
    } catch {
      setFailed(true);
    }
  };
  const refresh = async () => {
    await load();
    window.dispatchEvent(new Event(changed));
  };
  const save = async (input: {
    stars: number | null;
    body: string;
    expectedRevision: number | null;
  }) => {
    setBusy(true);
    setFeedback(null);
    try {
      await subjectApi(`${base}/review`, "PUT", input);
      await refresh();
      setFeedback({ tone: "success", text: t.reviewSaved });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        await load();
        setFeedback({ tone: "error", text: t.reviewConflict });
      } else setFeedback({ tone: "error", text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = async (expectedRevision: number) => {
    setBusy(true);
    setFeedback(null);
    try {
      await subjectApi(`${base}/review`, "DELETE", { expectedRevision });
      await refresh();
      setFeedback({ tone: "success", text: t.itemReviewDeleted });
    } catch (e) {
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        await load();
        setFeedback({ tone: "error", text: t.reviewConflict });
      } else setFeedback({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;
  const summary = data?.summary;
  const own = data?.own && data.own.status !== "deleted" ? data.own : null;
  return (
    <details
      className="layer-item-reviews"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {t.itemReviewsTitle}
        {summary && summary.totalReviews > 0 && (
          <>
            {" "}
            <span className="count-pill">{summary.totalReviews}</span>
          </>
        )}
      </summary>
      <h4 className="sr-only">
        {format(t.itemReviewsFor, { name: itemName })}
      </h4>
      {failed && (
        <p className="message error-message" role="alert">
          {t.itemReviewLoadFailed}
        </p>
      )}
      {!data && open && !failed && <p className="fine-print">{t.loading}</p>}
      {data && summary && (
        <>
          <p className="rating-line">
            {summary.averageStars === null
              ? t.noRatingsYet
              : format(t.ratingSummary, {
                  average: summary.averageStars.toFixed(1),
                  count: summary.ratedCount,
                })}
            {summary.totalReviews > 0 &&
              ` · ${format(t.reviewCount, { count: summary.totalReviews })}`}
          </p>
          <ul className="review-list">
            {data.reviews.length === 0 && (
              <li className="muted">{t.noReviewsYet}</li>
            )}
            {data.reviews.map((review) => (
              <li key={review.id}>
                {review.stars !== null && <Stars value={review.stars} t={t} />}
                {review.body && <p>{review.body}</p>}
                <span className="fine-print">
                  {format(t.itemReviewByline, {
                    name: review.mine ? t.itemReviewYou : review.author.name,
                    date: new Date(review.updatedAt).toLocaleDateString(locale),
                  })}
                  {review.mine &&
                    data.own?.status === "pending" &&
                    ` · ${t.reviewStatusPending}`}
                </span>
              </li>
            ))}
          </ul>
          {data.nextCursor && (
            <button
              type="button"
              className="button secondary small"
              onClick={more}
            >
              {t.itemReviewMore}
            </button>
          )}
          {data.canReview ? (
            <ItemReviewForm
              key={`${data.own?.id ?? "new"}:${data.own?.revision ?? 0}`}
              own={data.own}
              t={t}
              busy={busy}
              onSubmit={save}
              onDelete={remove}
            />
          ) : (
            <p className="fine-print">{t.itemReviewSignIn}</p>
          )}
          {own?.status === "pending" && (
            <p className="notice" role="status">
              {t.itemReviewPendingOwn}
            </p>
          )}
          <StatusMessage feedback={feedback} />
        </>
      )}
    </details>
  );
}

/** Star radio group, comment, save and delete for the member's own review. */
function ItemReviewForm({
  own,
  t,
  busy,
  onSubmit,
  onDelete,
}: {
  own: ItemOwn | null;
  t: Copy;
  busy: boolean;
  onSubmit: (input: {
    stars: number | null;
    body: string;
    expectedRevision: number | null;
  }) => Promise<boolean>;
  onDelete: (expectedRevision: number) => Promise<void>;
}) {
  const id = useId();
  const active = own && own.status !== "deleted" ? own : null;
  const [stars, setStars] = useState<number | null>(active?.stars ?? null);
  const [body, setBody] = useState(active?.body ?? "");
  const [hint, setHint] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (stars === null && !body.trim()) {
      setHint(t.reviewEmpty);
      return;
    }
    setHint(null);
    await onSubmit({
      stars,
      body: body.trim(),
      // A deleted review is revived with its last revision.
      expectedRevision: own?.revision ?? null,
    });
  };
  return (
    <form className="review-editor" onSubmit={submit}>
      <h5>{t.itemReviewMine}</h5>
      <fieldset className="star-input">
        <legend>{t.starsLabel}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={stars !== null && n <= stars ? "on" : ""}>
            <input
              type="radio"
              name={`${id}-stars`}
              value={n}
              checked={stars === n}
              onChange={() => setStars(n)}
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
            onChange={() => setStars(null)}
          />
          {t.noStars}
        </label>
      </fieldset>
      <label>
        {t.reviewComment}
        <textarea
          value={body}
          maxLength={maxReviewBodyLength}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {own && (
        <p className="fine-print" role="status">
          {statusLabel({ ...own, scope: "" }, t)}
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
          {busy ? t.saving : t.itemReviewSave}
        </button>
        {active && (
          <button
            type="button"
            className="button secondary small"
            disabled={busy}
            onClick={() => onDelete(active.revision)}
          >
            {t.deleteReview}
          </button>
        )}
      </div>
    </form>
  );
}

/** Resolves a row's item id from its key, then mounts the panel. */
export function LayerItemReviewsByKey({
  layerId,
  itemKey,
  itemName,
  t,
  locale,
}: {
  layerId: string;
  itemKey: string;
  itemName: string;
  t: Copy;
  locale: Locale;
}) {
  const { ids, ratings, available } = useLayerItemRatings(layerId);
  const itemId = ids.get(itemKey);
  if (!available || !itemId) return null;
  return (
    <>
      <LayerItemRatingBadge rating={ratings[itemId]} t={t} />
      <LayerItemReviews
        layerId={layerId}
        itemId={itemId}
        itemName={itemName}
        t={t}
        locale={locale}
      />
    </>
  );
}
