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
