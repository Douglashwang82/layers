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
  /* Google Places / external place work (docs/plans/google-places-implementation-plan.md).
     Off unless explicitly enabled; existing authorized reads and removals stay available. */
  /** Provider-backed discovery and resolving provider references. */
  googlePlacesDiscovery: process.env.FEATURE_GOOGLE_PLACES_DISCOVERY === "true",
  /** New TaiwanHub review writes. */
  placeReviewWrites: process.env.FEATURE_PLACE_REVIEW_WRITES === "true",
  /** New external-place saves and layer writes. */
  externalPlaceCollections:
    process.env.FEATURE_EXTERNAL_PLACE_COLLECTIONS === "true",
  /** Member-created places in private/group layers (docs/plans/layer-scoped-places-design.md). */
  layerCustomPlaces: process.env.FEATURE_LAYER_CUSTOM_PLACES === "true",
  /** Presentation-only map selection effects. */
  mapEffects: process.env.FEATURE_MAP_EFFECTS === "true",
  /* Daily restaurant recommendation, version 2
     (docs/plans/daily-restaurant-recommendation-implementation-plan.md).
     All off unless explicitly enabled; each requires the Phase 0 provider/
     retention ADR and a per-area `restaurant_discovery_area.enabled` row
     before any live run, regardless of these flags. */
  /** Runs the discovery/qualification worker at all (still per-area gated). */
  restaurantDiscoveryWorker:
    process.env.FEATURE_RESTAURANT_DISCOVERY_WORKER === "true",
  /** Publishes a run's winner automatically instead of requiring moderator publish. */
  restaurantAutoPublish: process.env.FEATURE_RESTAURANT_AUTO_PUBLISH === "true",
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
/**
 * What the browser needs for places work. The UI Kit key is intentionally
 * browser-visible (restricted by referrer/API in Google Cloud) and is only
 * handed out while discovery is enabled, so a disabled flag loads no provider.
 */
export function placesClientConfig() {
  return {
    providerKey: flags.googlePlacesDiscovery
      ? process.env.NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_KEY || null
      : null,
    reviewWrites: flags.placeReviewWrites,
    collections: flags.externalPlaceCollections,
    mapEffects: flags.mapEffects,
  };
}
