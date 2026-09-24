import { z } from "zod";
import { plainText } from "./text";
/** trim + lowercase only, matching the existing group_invite convention; no Gmail-dot or +tag stripping. */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
export const nominationEmailInput = z.object({
  email: z.email(),
  note: plainText(300).optional(),
});
export const nominationPatchInput = z.object({
  note: plainText(300).optional(),
  revision: z.number().int().min(1),
});
export const revisionedInput = z.object({
  revision: z.number().int().min(1),
});
export const nominationDecisionInput = z
  .object({
    decision: z.enum(["approve", "needs_info", "reject"]),
    revision: z.number().int().min(1),
    reason: plainText(500).optional(),
  })
  .refine(
    (v) => v.decision === "approve" || !!v.reason,
    "A reason is required for this decision.",
  );
export const reviewerToggleInput = z.object({
  enabled: z.boolean(),
  reason: plainText(300).optional(),
});
export const batchCreateInput = z.object({
  name: plainText(120),
  capacity: z.number().int().min(1).max(100000),
});
export const batchUpdateInput = z.object({
  name: plainText(120).optional(),
  capacity: z.number().int().min(1).max(100000).optional(),
  status: z.enum(["open", "closed"]).optional(),
});
export const adminDirectInviteInput = z.object({
  email: z.email(),
  batchId: z.uuid(),
  delivery: z.enum(["manual", "email"]),
});
export const joinContextInput = z.object({
  token: z.string().min(20).max(200),
  returnTo: z.string().max(2048).optional(),
});
export const joinAcceptInput = z.object({
  acceptTerms: z.literal(true),
});
export const joinEmailCompleteInput = z.object({
  otp: z.string().regex(/^\d{4,10}$/),
});
/**
 * Only a same-origin relative path may ride along with an invitation link.
 * Rejects protocol-relative ("//host"), backslash tricks, and any scheme.
 */
export function safeReturnTo(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith("/")) return undefined;
  if (value.startsWith("//")) return undefined;
  if (value.includes("\\")) return undefined;
  if (/^\/\/|^\/[a-z]+:/i.test(value)) return undefined;
  try {
    // A relative path must not resolve to a different origin.
    const resolved = new URL(value, "http://membership.invalid");
    if (resolved.origin !== "http://membership.invalid") return undefined;
  } catch {
    return undefined;
  }
  return value;
}
export const nominationStatuses = [
  "pending_review",
  "needs_info",
  "approved",
  "joined",
  "withdrawn",
  "rejected",
  "closed",
] as const;
export type NominationStatus = (typeof nominationStatuses)[number];
export const nominationTransitions: Record<
  NominationStatus,
  readonly NominationStatus[]
> = {
  pending_review: ["needs_info", "approved", "withdrawn", "rejected"],
  needs_info: ["pending_review", "withdrawn", "rejected"],
  approved: ["joined", "closed"],
  joined: [],
  withdrawn: [],
  rejected: [],
  closed: [],
};
export function canTransitionNomination(
  from: NominationStatus,
  to: NominationStatus,
) {
  return nominationTransitions[from].includes(to);
}
export const invitationStatuses = [
  "issued",
  "redeemed",
  "revoked",
  "expired",
] as const;
export type InvitationStatus = (typeof invitationStatuses)[number];
/** Batch capacity used = redeemed invitations + not-yet-expired issued invitations. */
export function batchSeatsUsed(redeemed: number, activeIssued: number) {
  return redeemed + activeIssued;
}
export function batchHasCapacity(
  capacity: number,
  redeemed: number,
  activeIssued: number,
) {
  return batchSeatsUsed(redeemed, activeIssued) < capacity;
}
export const membershipErrorCodes = {
  INVITE_REQUIRED: "INVITE_REQUIRED",
  INVITE_INVALID: "INVITE_INVALID",
  INVITE_EMAIL_MISMATCH: "INVITE_EMAIL_MISMATCH",
  INVITE_ALREADY_REDEEMED: "INVITE_ALREADY_REDEEMED",
  SELF_APPROVAL_FORBIDDEN: "SELF_APPROVAL_FORBIDDEN",
  REVIEWER_REQUIRED: "REVIEWER_REQUIRED",
  EMAIL_VERIFICATION_REQUIRED: "EMAIL_VERIFICATION_REQUIRED",
  NOMINATION_UNAVAILABLE: "NOMINATION_UNAVAILABLE",
  REVISION_CONFLICT: "REVISION_CONFLICT",
  BATCH_FULL: "BATCH_FULL",
  MEMBERSHIP_PAUSED: "MEMBERSHIP_PAUSED",
  MAIL_UNAVAILABLE: "MAIL_UNAVAILABLE",
} as const;
