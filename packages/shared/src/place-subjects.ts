import { z } from "zod";
/* ---------------------------------------------------------------------------
   Place subjects: local identity for catalog places and provider-referenced
   (external) businesses. Provider IDs are untrusted input — proof of neither
   existence, city, ownership nor verification. See
   docs/google-places-implementation-plan.md sections 5–7.
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
