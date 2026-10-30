"use client";
import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Star } from "lucide-react";
import { reviewsChangedEvent } from "@/components/layers/layer-item-reviews";
import { type Copy, format } from "@/lib/dictionary";

export type ReviewPreview = {
  averageStars: number | null;
  ratedCount: number;
  commentCount: number;
  reviewerCount: number;
  reviewers: { name: string; image: string | null }[];
};
/** Width the review column adds to a hover card, for keeping it inside the map. */
export const tipReviewsWidth = 64;

const none: Record<string, ReviewPreview> = {};

/**
 * Approved-review previews for the pins of one map query, by marker key.
 * Nothing loads until `request()` (the first pin hover for this query), so
 * touch screens and quick visits never pay for it. Previews of an earlier
 * query are never shown for the current one.
 */
export function useMapReviewPreviews(queryKey: string) {
  const [wanted, setWanted] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{
    key: string;
    previews: Record<string, ReviewPreview>;
  } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const changed = () => setVersion((v) => v + 1);
    window.addEventListener(reviewsChangedEvent, changed);
    return () => window.removeEventListener(reviewsChangedEvent, changed);
  }, []);
  useEffect(() => {
    if (wanted !== queryKey) return;
    const controller = new AbortController();
    fetch(`/api/v1/map/review-previews${queryKey}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (json: { data?: { previews: Record<string, ReviewPreview> } } | null) =>
          setLoaded({ key: queryKey, previews: json?.data?.previews ?? none }),
      )
      .catch(() => {
        if (!controller.signal.aborted)
          setLoaded({ key: queryKey, previews: none });
      });
    return () => controller.abort();
  }, [queryKey, wanted, version]);
  const request = useCallback(() => setWanted(queryKey), [queryKey]);
  return {
    previews: loaded?.key === queryKey ? loaded.previews : none,
    request,
  };
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="tip-avatar" title={name}>
      {image && !failed ? (
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        (Array.from(name.trim())[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}

/** The hover card's right column: reviewer avatars, comment count, average rating. */
export function TipReviews({
  preview,
  t,
}: {
  preview: ReviewPreview | undefined;
  t: Copy;
}) {
  if (!preview || preview.reviewerCount === 0) return null;
  const names = preview.reviewers.map((r) => r.name).join(", ");
  const more = preview.reviewerCount - preview.reviewers.length;
  const average =
    preview.averageStars === null ? null : preview.averageStars.toFixed(1);
  return (
    <div className="tip-reviews">
      <span
        className="tip-avatars"
        role="img"
        aria-label={
          more > 0
            ? format(t.tipReviewersMore, { names, count: more })
            : format(t.tipReviewers, { names })
        }
      >
        {preview.reviewers.map((r, i) => (
          <Avatar key={i} name={r.name} image={r.image} />
        ))}
        {more > 0 && (
          <span className="tip-avatar tip-avatar-more" aria-hidden="true">
            +{more}
          </span>
        )}
      </span>
      {preview.commentCount > 0 && (
        <span
          className="tip-review-stat"
          role="img"
          aria-label={format(
            preview.commentCount === 1 ? t.tipComment : t.tipComments,
            { count: preview.commentCount },
          )}
        >
          <MessageCircle size={14} aria-hidden="true" />
          {preview.commentCount}
        </span>
      )}
      {average !== null && preview.ratedCount > 0 && (
        <span
          className="tip-review-stat tip-review-rating"
          role="img"
          aria-label={format(t.itemRatingBadge, {
            average,
            count: preview.ratedCount,
          })}
        >
          <Star size={14} aria-hidden="true" fill="currentColor" />
          {average}
        </span>
      )}
    </div>
  );
}
