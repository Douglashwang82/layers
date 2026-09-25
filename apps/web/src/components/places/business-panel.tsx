"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Check, Plus, X } from "lucide-react";
import { StatusMessage } from "@/components/actions";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import type { PlacesProvider, ProviderPlace } from "@/lib/places/provider";
import {
  ApiError,
  subjectApi,
  type OwnReview,
  type Resolution,
  type ReviewScopeSummary,
} from "@/lib/places/api";
import { track } from "@/lib/track";
import { ProviderDetails } from "./provider-slot";
import { ReviewEditor, scopeLabel } from "./review-editor";
type Feedback = { tone: "success" | "error"; text: string } | null;
type SubjectDetail = {
  subjectId: string;
  canonicalKey: string;
  href: string;
  cityReviewStatus: "unreviewed" | "approved";
  providerReference: { provider: string; providerPlaceId: string } | null;
  saved: boolean;
};
type EditableLayer = {
  id: string;
  title: string;
  titleChinese: string;
  audience: string;
  contains: boolean;
};
type ReviewList = {
  items: {
    id: string;
    stars: number | null;
    body: string;
    authorName: string;
    createdAt: string;
  }[];
};
export type PlaceFlags = {
  reviewWrites: boolean;
  collections: boolean;
  layerWrites: boolean;
};
export function RatingLine({
  summary,
  t,
}: {
  summary: Pick<
    ReviewScopeSummary,
    "totalReviews" | "ratedCount" | "averageStars"
  >;
  t: Copy;
}) {
  return (
    <span className="rating-line">
      {summary.averageStars === null
        ? t.noRatingsYet
        : format(t.ratingSummary, {
            average: summary.averageStars.toFixed(1),
            count: summary.ratedCount,
          })}
      {summary.totalReviews > 0 &&
        ` · ${format(t.reviewCount, { count: summary.totalReviews })}`}
    </span>
  );
}
/**
 * The selected business: Google's attributed details in their own component,
 * then a clearly separate TaiwanHub region (save, add to layer, scoped
 * reviews). Browsing creates nothing; the first save/add/review resolves a
 * local subject. Drafts stay in memory through failures and sign-in prompts.
 */
export function BusinessPanel({
  provider,
  placeId,
  subjectId: initialSubjectId = null,
  temporary,
  authenticated,
  flags,
  t,
  locale,
  onClose,
  onLocation,
}: {
  provider: PlacesProvider | null;
  placeId: string | null;
  subjectId?: string | null;
  temporary: boolean;
  authenticated: boolean;
  flags: PlaceFlags;
  t: Copy;
  locale: Locale;
  onClose?: () => void;
  onLocation?: (place: ProviderPlace) => void;
}) {
  const pathname = usePathname();
  const [subjectId, setSubjectId] = useState<string | null>(initialSubjectId);
  const [detail, setDetail] = useState<SubjectDetail | null>(null);
  const [scopes, setScopes] = useState<ReviewScopeSummary[] | null>(null);
  const [groups, setGroups] = useState<ReviewScopeSummary[]>([]);
  const [providerState, setProviderState] = useState<
    "loading" | "ready" | "failed"
  >(provider && placeId ? "loading" : "failed");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [layers, setLayers] = useState<EditableLayer[] | null>(null);
  const [openReviews, setOpenReviews] = useState<Record<string, ReviewList>>(
    {},
  );
  const resolution = useRef<Resolution | null>(null);
  const seq = useRef(0);
  const effectivePlaceId =
    placeId ?? detail?.providerReference?.providerPlaceId ?? null;
  /* Local state only: lookup never creates a record and reveals only what this viewer may see. */
  const refresh = useCallback(async (id: string | null) => {
    const request = ++seq.current;
    if (!id) {
      setDetail(null);
      setScopes(null);
      return;
    }
    const [d, s] = await Promise.all([
      subjectApi<SubjectDetail>(`place-subjects/${id}`).catch(() => null),
      subjectApi<{ scopes: ReviewScopeSummary[] }>(
        `place-subjects/${id}/review-scopes`,
      ).catch(() => null),
    ]);
    if (request !== seq.current) return;
    setDetail(d);
    setScopes(s?.scopes ?? null);
  }, []);
  useEffect(() => {
    let active = true;
    (async () => {
      let id = initialSubjectId;
      if (!id && placeId) {
        const found = await subjectApi<{ subjectId: string | null }>(
          `place-subjects/lookup?provider=google&providerPlaceId=${encodeURIComponent(placeId)}`,
        ).catch(() => ({ subjectId: null }));
        id = found.subjectId;
      }
      if (!active) return;
      setSubjectId(id);
      await refresh(id);
    })();
    return () => {
      active = false;
    };
  }, [placeId, initialSubjectId, refresh]);
  useEffect(() => {
    if (!authenticated) return;
    subjectApi<{ id: string; name: string; nameChinese: string }[]>("groups")
      .then((list) =>
        setGroups(
          list.map((g) => ({
            scope: `group:${g.id}`,
            kind: "group",
            title: g.name,
            titleChinese: g.nameChinese,
            audience: "group",
            needsModeration: false,
            totalReviews: 0,
            ratedCount: 0,
            averageStars: null,
            ownReview: null,
          })),
        ),
      )
      .catch(() => setGroups([]));
  }, [authenticated]);
  /** Resolve on explicit intent only. The grant stays in memory, never in a URL. */
  const ensure = async (force = false) => {
    if (!force && resolution.current) return resolution.current;
    const body = effectivePlaceId
      ? { provider: "google", providerPlaceId: effectivePlaceId }
      : null;
    if (!body) throw new ApiError(404, "NOT_FOUND", t.externalUnavailable);
    const resolved = await subjectApi<Resolution>(
      "place-subjects/resolve",
      "POST",
      body,
    );
    resolution.current = resolved;
    setSubjectId(resolved.subjectId);
    return resolved;
  };
  /** Runs a write; an expired grant (404) is re-resolved once, keeping the draft. */
  const withSubject = async <T,>(
    action: (r: Resolution) => Promise<T>,
  ): Promise<T> => {
    const r =
      subjectId && !effectivePlaceId
        ? {
            subjectId,
            canonicalKey: `subject:${subjectId}`,
            cityReviewStatus: "unreviewed" as const,
            selectionGrant: "",
          }
        : await ensure();
    try {
      return await action(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && effectivePlaceId)
        return action(await ensure(true));
      throw e;
    }
  };
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401)
      setFeedback({ tone: "error", text: t.signInToReview });
    else setFeedback({ tone: "error", text: (e as Error).message || t.error });
  };
  const grantOf = (r: Resolution) =>
    r.selectionGrant ? { selectionGrant: r.selectionGrant } : {};
  const save = async (active: boolean) => {
    setBusy("save");
    setFeedback(null);
    try {
      await withSubject(async (r) => {
        await subjectApi(
          `place-subjects/${r.subjectId}/save`,
          active ? "POST" : "DELETE",
          active ? grantOf(r) : {},
        );
        await refresh(r.subjectId);
      });
      setFeedback({ tone: "success", text: active ? t.saved : t.save });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const loadLayers = async () => {
    if (layers) return setLayers(null);
    try {
      setLayers(
        await subjectApi<EditableLayer[]>(
          `place-subjects/editable-layers${subjectId ? `?subjectId=${subjectId}` : ""}`,
        ),
      );
    } catch (e) {
      fail(e);
    }
  };
  const addToLayer = async (layer: EditableLayer) => {
    setBusy(`layer:${layer.id}`);
    setFeedback(null);
    try {
      await withSubject(async (r) => {
        try {
          await subjectApi(`layers/${layer.id}/items`, "POST", {
            key: `subject:${r.subjectId}`,
            ...grantOf(r),
          });
          setLayers(
            (list) =>
              list?.map((l) =>
                l.id === layer.id ? { ...l, contains: true } : l,
              ) ?? null,
          );
          setFeedback({ tone: "success", text: t.addedToLayer });
        } catch (e) {
          // External places need a reviewed city first: save it so nothing is lost.
          if (e instanceof ApiError && e.code === "CITY_REVIEW_REQUIRED") {
            await subjectApi(
              `place-subjects/${r.subjectId}/save`,
              "POST",
              grantOf(r),
            );
            setFeedback({ tone: "success", text: t.savedCityReview });
          } else throw e;
        }
        await refresh(r.subjectId);
      });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const submitReview = async (input: {
    scope: string;
    stars: number | null;
    body: string;
    expectedRevision: number | null;
  }) => {
    setBusy("review");
    setFeedback(null);
    try {
      await withSubject(async (r) => {
        await subjectApi<OwnReview>(
          `place-subjects/${r.subjectId}/review`,
          "PUT",
          { ...input, ...grantOf(r) },
        );
        await refresh(r.subjectId);
      });
      setFeedback({ tone: "success", text: t.reviewSaved });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        await refresh(subjectId);
        setFeedback({ tone: "error", text: t.reviewConflict });
      } else fail(e);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const deleteReview = async (scope: string, expectedRevision: number) => {
    if (!subjectId) return;
    setBusy("review");
    try {
      await subjectApi(`place-subjects/${subjectId}/review`, "DELETE", {
        scope,
        expectedRevision,
      });
      await refresh(subjectId);
    } catch (e) {
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT")
        await refresh(subjectId);
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const toggleReviews = async (scope: string) => {
    if (!subjectId) return;
    if (openReviews[scope]) {
      setOpenReviews((o) => {
        const next = { ...o };
        delete next[scope];
        return next;
      });
      return;
    }
    try {
      const list = await subjectApi<ReviewList>(
        `place-subjects/${subjectId}/reviews?scope=${encodeURIComponent(scope)}`,
      );
      setOpenReviews((o) => ({ ...o, [scope]: list }));
    } catch (e) {
      fail(e);
    }
  };
  // Review targets: scopes the server reports, plus the member's groups for a first review.
  const editorScopes = [
    ...(scopes ?? []),
    ...groups.filter((g) => !(scopes ?? []).some((s) => s.scope === g.scope)),
  ];
  const signIn = `/sign-in?next=${encodeURIComponent(pathname)}`;
  return (
    <article className="business-panel" aria-label={t.businessResults}>
      <div className="business-head">
        {temporary && <span className="eyebrow">{t.temporaryResult}</span>}
        {onClose && (
          <button
            type="button"
            className="icon-button"
            aria-label={t.closeBusiness}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <section className="provider-region">
        {provider && effectivePlaceId ? (
          <ProviderDetails
            provider={provider}
            placeId={effectivePlaceId}
            compact={false}
            onLoad={(place) => {
              setProviderState("ready");
              track("places_component_loaded", { type: "details" });
              onLocation?.(place);
            }}
            onError={() => {
              setProviderState("failed");
              track("places_component_failed", { type: "details" });
            }}
          />
        ) : null}
        {providerState === "loading" && (
          <p className="fine-print" role="status">
            {t.businessLoading}
          </p>
        )}
        {providerState === "failed" && (
          <p className="fine-print" role="status">
            {t.businessDetailsUnavailable}
          </p>
        )}
      </section>
      <section className="community-region" aria-labelledby="community-heading">
        <h2 id="community-heading">{t.taiwanhubCommunity}</h2>
        <p className="fine-print">{t.providerNote}</p>
        {!authenticated ? (
          <p>
            <Link className="button small" href={signIn}>
              {t.signIn}
            </Link>{" "}
            <span className="muted">{t.signInToReview}</span>
          </p>
        ) : (
          <div className="actions">
            {(flags.collections || detail?.saved) && (
              <button
                type="button"
                className="button secondary small"
                aria-pressed={!!detail?.saved}
                disabled={busy !== null}
                onClick={() => save(!detail?.saved)}
              >
                {detail?.saved ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <Bookmark size={16} aria-hidden="true" />
                )}
                {busy === "save" ? t.saving : detail?.saved ? t.unsave : t.save}
              </button>
            )}
            {flags.collections && flags.layerWrites && (
              <button
                type="button"
                className="button secondary small"
                aria-expanded={!!layers}
                onClick={loadLayers}
              >
                <Plus size={16} aria-hidden="true" /> {t.addToLayer}
              </button>
            )}
          </div>
        )}
        {layers && (
          <div className="picker" role="group" aria-label={t.chooseLayerPicker}>
            {layers.length === 0 ? (
              <p className="muted">{t.noLayersMine}</p>
            ) : (
              <ul className="picker-list">
                {layers.map((layer) => (
                  <li key={layer.id}>
                    <button
                      type="button"
                      className="picker-row"
                      disabled={layer.contains || busy !== null}
                      aria-busy={busy === `layer:${layer.id}` || undefined}
                      onClick={() => addToLayer(layer)}
                    >
                      <span className="picker-text">
                        {locale === "zh-TW" && layer.titleChinese
                          ? layer.titleChinese
                          : layer.title}
                      </span>
                      {layer.contains && (
                        <span className="picker-state">
                          <Check size={14} aria-hidden="true" />
                          {t.alreadyInLayer}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <StatusMessage feedback={feedback} />
        {(scopes ?? []).map((scope) => (
          <div key={scope.scope} className="review-scope">
            <h3>
              {format(t.reviewsIn, { scope: scopeLabel(scope, t, locale) })}
            </h3>
            <p>
              <RatingLine summary={scope} t={t} />{" "}
              {scope.totalReviews > 0 && (
                <button
                  type="button"
                  className="text-button"
                  aria-expanded={!!openReviews[scope.scope]}
                  onClick={() => toggleReviews(scope.scope)}
                >
                  {openReviews[scope.scope] ? t.close : t.viewAll}
                </button>
              )}
            </p>
            {openReviews[scope.scope] && (
              <ul className="review-list">
                {openReviews[scope.scope].items.length === 0 && (
                  <li className="muted">{t.noReviewsYet}</li>
                )}
                {openReviews[scope.scope].items.map((review) => (
                  <li key={review.id}>
                    {review.stars !== null && (
                      <span className="review-stars">
                        {format(t.starsOption, { count: review.stars })}
                      </span>
                    )}
                    {/* Plain text only: React escapes it; never rendered as HTML. */}
                    {review.body && <p>{review.body}</p>}
                    <small>
                      {review.authorName} ·{" "}
                      {new Date(review.createdAt).toLocaleDateString(locale)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {authenticated && flags.reviewWrites && (
          <ReviewEditor
            scopes={editorScopes}
            t={t}
            locale={locale}
            busy={busy === "review"}
            onSubmit={submitReview}
            onDelete={deleteReview}
          />
        )}
        {detail && !temporary && detail.href.startsWith("/places/") && (
          <Link className="text-button" href={detail.href}>
            {t.openPlacePage}
          </Link>
        )}
        {subjectId && temporary && (
          <Link className="text-button" href={`/place-subjects/${subjectId}`}>
            {t.openPlacePage}
          </Link>
        )}
      </section>
    </article>
  );
}
