import { AppError, requireActor, type Actor } from "@taiwanhub/shared";
import { isEffectiveReviewer } from "./repository";
/**
 * A capability, not a role: MODERATOR/ADMIN on content never implies review
 * rights here, and grants/revocations take effect on the very next request
 * because this always re-queries membership_reviewer (see plan section 4).
 */
export async function requireReviewer(actor: Actor | null): Promise<Actor> {
  const a = requireActor(actor);
  if (a.role === "ADMIN") return a;
  if (!(await isEffectiveReviewer(a.id)))
    throw new AppError(
      403,
      "REVIEWER_REQUIRED",
      "Reviewer access is required for this action.",
    );
  return a;
}
export function requireAdmin(actor: Actor | null): Actor {
  const a = requireActor(actor);
  if (a.role !== "ADMIN")
    throw new AppError(403, "FORBIDDEN", "Administrator access is required.");
  return a;
}
