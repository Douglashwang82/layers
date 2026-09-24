export const flags = {
  products: process.env.FEATURE_PRODUCTS !== "false",
  organizations: process.env.FEATURE_ORGANIZATIONS !== "false",
  submissions: process.env.FEATURE_SUBMISSIONS !== "false",
  /** Map-first home. Off restores the previous content-first entry screen without touching layer data. */
  mapHome: process.env.FEATURE_MAP_HOME !== "false",
  /** Personal/group layer writes (create, edit, add, follow). Reads stay available. */
  layerWrites: process.env.FEATURE_LAYER_WRITES !== "false",
  /** General local content (posts) in layers and results. */
  content: process.env.FEATURE_CONTENT !== "false",
};
export const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
/**
 * Fail closed: an unset or unrecognized value blocks new admission rather than
 * silently allowing it. `invite_only` is the only value that opens the flow;
 * `closed` and issuance pause keep existing logins working either way.
 */
export const membershipMode: "closed" | "invite_only" =
  process.env.MEMBERSHIP_MODE === "invite_only" ? "invite_only" : "closed";
export const membershipIssuancePaused =
  process.env.MEMBERSHIP_ISSUANCE_PAUSED === "true";
