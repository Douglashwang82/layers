/** Layer panel state is independent of the map's filters and applied layers. */
export const layerPanelKeys = [
  "layerPanel",
  "layer",
  "layerTab",
  "layerQ",
  "add",
  "next",
  "group",
  "blank",
] as const;
export type LayerPanel = "library" | "detail" | "new" | "settings" | "contents";
export function readLayerPanel(params: URLSearchParams): LayerPanel | null {
  const value = params.get("layerPanel");
  return ["library", "detail", "new", "settings", "contents"].includes(
    value ?? "",
  )
    ? (value as LayerPanel)
    : null;
}
/** Convert legacy layer links while retaining only the current map context. */
export function layerWorkspaceHref(href: string, current = ""): string {
  const target = new URL(href, "https://local.invalid");
  if (target.origin !== "https://local.invalid") return href;
  const match = target.pathname.match(
    /^\/layers(?:\/([^/]+)(?:\/(edit))?)?\/?$/,
  );
  if (!match) return href;
  const params = new URLSearchParams(current.replace(/^\?/, ""));
  for (const key of layerPanelKeys) params.delete(key);
  const slug = match[1];
  params.set(
    "layerPanel",
    !slug
      ? "library"
      : slug === "new"
        ? "new"
        : match[2]
          ? target.hash === "#add-items"
            ? "contents"
            : "settings"
          : "detail",
  );
  if (slug && slug !== "new") params.set("layer", decodeURIComponent(slug));
  for (const key of ["city", "add", "next", "group", "blank"]) {
    const value = target.searchParams.get(key);
    if (value !== null) params.set(key, value);
  }
  if (target.searchParams.has("tab"))
    params.set("layerTab", target.searchParams.get("tab")!);
  if (target.searchParams.has("q"))
    params.set("layerQ", target.searchParams.get("q")!);
  return "/?" + params.toString();
}
export function withoutLayerPanel(current: string) {
  const params = new URLSearchParams(current);
  for (const key of layerPanelKeys) params.delete(key);
  return "/" + (params.size ? "?" + params.toString() : "");
}
