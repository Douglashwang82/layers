import { loggedFetch } from "@taiwanhub/database";
import { AppError } from "@taiwanhub/shared";
import { fakeResolverFetch, type ResolverDeps } from "./resolver";
/** Server-only key; "fake" selects the deterministic test double outside production. */
export function resolverDeps(): ResolverDeps {
  const key = process.env.GOOGLE_MAPS_LINK_API_KEY;
  if (key === "fake" && process.env.NODE_ENV !== "production")
    return { fetch: fakeResolverFetch, apiKey: "fake" };
  if (!key || key === "fake")
    throw new AppError(
      503,
      "UNAVAILABLE",
      "Google Maps links are not configured on this server.",
    );
  return { fetch: loggedFetch("google-places", "link-resolver"), apiKey: key };
}
