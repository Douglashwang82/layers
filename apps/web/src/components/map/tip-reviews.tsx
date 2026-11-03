"use client";
import { useCallback, useEffect, useState } from "react";
import { Star } from "lucide-react";
import { reviewsChangedEvent } from "@/components/layers/layer-item-reviews";
import { type Copy, format } from "@/lib/dictionary";

export type ReviewPreview = {
  reviewerCount: number;
  reviews: {
    name: string;
    image: string | null;
    stars: number | null;
    comment: string;
  }[];
};
/** Width of the review list beside a hover card (gap included), for keeping it inside the map. */
export const tipReviewsWidth = 246;
/** Approximate height of the review list (rows with two-line bubbles), for flipping the card above the pointer. */
export function tipReviewsHeight(preview: ReviewPreview | undefined) {
  if (!preview?.reviews.length) return 0;
  const more = preview.reviewerCount > preview.reviews.length ? 32 : 0;
  return preview.reviews.length * 72 + more;
}

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

/**
 * Beside the hover card: each reviewer's avatar, their stars and a speech
 * bubble with their comment, newest first, then "+N more".
 */
export function TipReviews({
  preview,
  t,
}: {
  preview: ReviewPreview | undefined;
  t: Copy;
}) {
  if (!preview?.reviews.length) return null;
  const more = preview.reviewerCount - preview.reviews.length;
  return (
    <ul className="tip-reviews" aria-label={t.tipReviewsLabel}>
      {preview.reviews.map((review, i) => (
        <li key={i} className="tip-review">
          <Avatar name={review.name} image={review.image} />
          <div className="tip-review-body">
            <span className="sr-only">{review.name}</span>
            {review.stars !== null && (
              <span
                className="tip-review-stars"
                role="img"
                aria-label={format(t.starsOption, { count: review.stars })}
              >
                {Array.from({ length: review.stars }, (_, n) => (
                  <Star key={n} size={13} aria-hidden="true" />
                ))}
              </span>
            )}
            {review.comment && (
              <p className="tip-bubble">
                <span className="tip-bubble-text">{review.comment}</span>
              </p>
            )}
          </div>
        </li>
      ))}
      {more > 0 && (
        <li className="tip-review-more">
          {format(t.tipMoreReviewers, { count: more })}
        </li>
      )}
    </ul>
  );
}
