/** A stable per-layer hue, so a layer keeps its color across sessions. */
export function layerColor(slug: string) {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash} 55% 45%)`;
}
