import { z } from "zod";
/* ---------------------------------------------------------------------------
   Place subjects: local identity for catalog places and provider-referenced
   (external) businesses. Provider IDs are untrusted input — proof of neither
   existence, city, ownership nor verification. See
   docs/plans/google-places-implementation-plan.md sections 5–7.
   --------------------------------------------------------------------------- */
export const placeProviders = ["google"] as const;
export type PlaceProvider = (typeof placeProviders)[number];
export const placeSubjectStatuses = ["active", "hidden", "deleted"] as const;
export type PlaceSubjectStatus = (typeof placeSubjectStatuses)[number];
export const cityReviewStatuses = ["unreviewed", "approved"] as const;
export type CityReviewStatus = (typeof cityReviewStatuses)[number];
export const maxProviderPlaceIdLength = 512;
/** Google place IDs are URL-safe tokens; anything else is rejected before it reaches SQL. */
export const providerPlaceId = z
  .string()
  .min(1)
  .max(maxProviderPlaceIdLength)
  .regex(/^[A-Za-z0-9_-]+$/, "Unsupported place identifier.");
/** Strict union: a catalog place OR a provider reference, never both or extra fields. */
export const placeSubjectResolveInput = z.union([
  z.strictObject({ catalogPlaceId: z.uuid() }),
  z.strictObject({
    provider: z.enum(placeProviders),
    providerPlaceId,
  }),
]);
export type PlaceSubjectResolveInput = z.infer<typeof placeSubjectResolveInput>;
export const placeSubjectLookupInput = z.object({
  provider: z.enum(placeProviders),
  providerPlaceId,
});
/** Bounded opaque token; verification happens server-side. */
export const selectionGrantToken = z.string().min(1).max(1024);
export const placeSubjectSaveInput = z.strictObject({
  selectionGrant: selectionGrantToken.optional(),
});
/**
 * Reference kind for external subjects. Deliberately separate from `ItemType`:
 * an external subject is still a place, so `types=place` keeps covering it.
 */
export type SubjectKey = `subject:${string}`;
export const subjectKeyPattern = /^subject:([0-9a-f-]{36})$/;
export function subjectKey(id: string): SubjectKey {
  return `subject:${id}`;
}
export function parseSubjectKey(value: string | undefined | null) {
  const match = value ? subjectKeyPattern.exec(value) : null;
  return match ? { kind: "subject" as const, id: match[1] } : null;
}
/** A subject linked to a catalog place keeps the existing `place:` identity. */
export function canonicalSubjectKey(subject: {
  id: string;
  catalogPlaceId: string | null;
}) {
  return subject.catalogPlaceId
    ? (`place:${subject.catalogPlaceId}` as const)
    : subjectKey(subject.id);
}
/** Subject pages resolve through authorization; never a slug derived from provider data. */
export function subjectHref(id: string) {
  return `/place-subjects/${id}`;
}
/* ---------------------------------------------------------------------------
   Scoped reviews (plan decision D1): a review belongs to one layer or one
   group. Aggregates are per scope and never merged across scopes.
   --------------------------------------------------------------------------- */
export const reviewScopeKinds = ["layer", "group"] as const;
export type ReviewScopeKind = (typeof reviewScopeKinds)[number];
export type ReviewScope = { kind: ReviewScopeKind; id: string };
export const reviewScopePattern = /^(layer|group):([0-9a-f-]{36})$/;
export const reviewScope = z
  .string()
  .regex(reviewScopePattern, "Choose a layer or group for this review.")
  .transform((v): ReviewScope => {
    const [kind, id] = v.split(":");
    return { kind: kind as ReviewScopeKind, id };
  });
export function reviewScopeKey(scope: ReviewScope) {
  return `${scope.kind}:${scope.id}`;
}
export const reviewStatuses = [
  "pending",
  "approved",
  "rejected",
  "hidden",
  "deleted",
] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];
export const maxReviewBodyLength = 2000;
/** Plain text rendered as text, never HTML; only control characters are refused. */
const reviewBody = z
  .string()
  .trim()
  .max(maxReviewBodyLength)
  .refine(
    (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),
    "Remove unsupported characters.",
  );
export const reviewStars = z.number().int().min(1).max(5);
export const placeReviewInput = z
  .strictObject({
    scope: reviewScope,
    stars: reviewStars.nullable(),
    body: reviewBody.default(""),
    expectedRevision: z.number().int().min(1).nullable(),
    selectionGrant: selectionGrantToken.optional(),
  })
  .refine(
    (v) => v.stars !== null || v.body.length > 0,
    "Add stars, a comment, or both.",
  );
export type PlaceReviewInput = z.infer<typeof placeReviewInput>;
export const placeReviewDeleteInput = z.strictObject({
  scope: reviewScope,
  expectedRevision: z.number().int().min(1),
});
export const reviewDecisionInput = z.strictObject({
  action: z.enum(["approved", "rejected", "hidden", "deleted"]),
  expectedRevision: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500),
});
export type ReviewDecision = z.infer<typeof reviewDecisionInput>["action"];
/**
 * Status after an owner writes content. Returns null when the owner may not
 * revive the review (a moderator deleted it). Hidden stays hidden; rejected
 * content always goes back to a moderator; otherwise the scope decides.
 */
export function ownerWriteStatus(
  current: { status: ReviewStatus; deletionSource: string | null } | null,
  scopeNeedsModeration: boolean,
): ReviewStatus | null {
  if (current?.status === "deleted" && current.deletionSource === "moderator")
    return null;
  if (current?.status === "hidden") return "hidden";
  if (current?.status === "rejected") return "pending";
  return scopeNeedsModeration ? "pending" : "approved";
}
export type RatingSummary = {
  totalReviews: number;
  ratedCount: number;
  averageStars: number | null;
};
/** Average to one decimal over rated reviews only; no ratings is null, never 0. */
export function summarizeRatings(stars: Array<number | null>): RatingSummary {
  const rated = stars.filter((s): s is number => s !== null);
  return {
    totalReviews: stars.length,
    ratedCount: rated.length,
    averageStars: rated.length
      ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10
      : null,
  };
}
