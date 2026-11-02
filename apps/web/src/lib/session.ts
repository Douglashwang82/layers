import { headers } from "next/headers";
import { auth } from "./auth";
import { type Actor, type Role } from "@taiwanhub/shared";
import { admittedRole, isAdmitted } from "@/features/membership/repository";
/**
 * The raw Better Auth session (cookie or bearer). Never use it to grant
 * application privileges: a session can exist without membership admission,
 * e.g. after an interrupted join or a native/OAuth route. Use currentActor.
 */
export async function currentSession() {
  return auth.api.getSession({ headers: await headers() });
}
/** Admission-aware actor for explicit request headers (session cookie or bearer token). */
export async function resolveActor(
  requestHeaders: Headers,
): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session || !(await isAdmitted(session.user.id))) return null;
  return { id: session.user.id, role: session.user.role as Role };
}
/**
 * Admission-aware actor for a verified MCP access token's subject. The role
 * is read from the database, never from token claims, so a demotion or a
 * revoked admission takes effect on the next tool call.
 */
export async function resolveMcpActor(subject: unknown): Promise<Actor | null> {
  if (
    typeof subject !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      subject,
    )
  )
    return null;
  const role = await admittedRole(subject);
  return role ? { id: subject, role: role as Role } : null;
}
/** The admission-aware actor used by every page, API route and upload. */
export async function currentActor(): Promise<Actor | null> {
  return resolveActor(await headers());
}
