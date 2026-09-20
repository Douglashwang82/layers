import { headers } from "next/headers";
import { auth } from "./auth";
import { type Actor, type Role } from "@taiwanhub/shared";
export async function currentSession() {
  return auth.api.getSession({ headers: await headers() });
}
export async function currentActor(): Promise<Actor | null> {
  const session = await currentSession();
  return session
    ? { id: session.user.id, role: session.user.role as Role }
    : null;
}
