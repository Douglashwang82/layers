import type { ItemType } from "@taiwanhub/shared";

/** Small, fixed-perspective vector models, rasterized once into the map atlas.
 * No user content is interpolated. The base at (32, 56) is the location anchor.
 * A storefront represents all places, not just restaurants.
 */
export function markerArtwork(type: ItemType): string {
  const objects: Record<ItemType, string> = {
    place: `
      <path d="M12 27L40 21L53 29V48L25 56L12 47Z" fill="#e8eee3"/>
      <path d="M40 21L53 29V48L40 43Z" fill="#b8cdc0"/>
      <path d="M12 27L40 21V48L12 47Z" fill="url(#wall)"/>
      <path d="M11 25L38 18L54 26L26 34Z" fill="#71c2a6"/>
      <path d="M11 25L26 34V39L11 31Z" fill="#087f65"/>
      <path d="M26 34L54 26V31L26 39Z" fill="#299d7b"/>
      <path d="M29 40L39 37V51L29 54Z" fill="#28564b"/>
      <path d="M43 36L49 34V43L43 45Z" fill="#759e92"/>
      <path d="M15 35L22 39V47L15 43Z" fill="#87b5a3"/>
      <path d="M19 23L34 19L48 27L42 29Z" fill="#e9f2dc" opacity=".9"/>
      <path d="M31 42L36 40V49L31 50Z" fill="#b5d7c5" opacity=".7"/>`,
    event: `
      <path d="M13 18L42 12L53 19V47L24 55L13 47Z" fill="#d3b9ad"/>
      <path d="M24 26L53 19V47L24 55Z" fill="url(#paper)"/>
      <path d="M13 18L24 26V55L13 47Z" fill="#decbbf"/>
      <path d="M13 18L42 12L53 19L24 27Z" fill="#ffa58a"/>
      <path d="M24 26L53 19V28L24 36Z" fill="#d8755f"/>
      <path d="M13 18L24 26V36L13 28Z" fill="#b95647"/>
      <path d="M31 20V14M44 17V11" stroke="#456455" stroke-width="4" stroke-linecap="round"/>
      <g fill="#a96050"><path d="M30 39L35 38V42L30 43Z"/><path d="M40 36L45 35V39L40 40Z"/><path d="M30 46L35 45V49L30 50Z"/><path d="M40 43L45 42V46L40 47Z"/></g>`,
    content: `
      <path d="M14 16L38 11L51 22V47L25 55L14 47Z" fill="#c7af78"/>
      <path d="M25 23L42 18L51 25V47L25 55Z" fill="url(#paper)"/>
      <path d="M14 16L38 11L48 17L25 24Z" fill="#f7dfa3"/>
      <path d="M14 16L25 24V55L14 47Z" fill="#dbb957"/>
      <path d="M42 18V28L51 25Z" fill="#e6c66e"/>
      <path d="M30 34L44 30M30 41L44 37M30 48L39 45" stroke="#8d794b" stroke-width="2.5" stroke-linecap="round"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 64 64">
    <defs>
      <linearGradient id="wall" x2=".7" y2="1"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#dce8db"/></linearGradient>
      <linearGradient id="paper" x2=".5" y2="1"><stop stop-color="#fffef6"/><stop offset="1" stop-color="#eee7d3"/></linearGradient>
    </defs>
    <ellipse cx="33" cy="55" rx="23" ry="6" fill="#19392f" opacity=".12"/>
    ${objects[type]}
  </svg>`;
}

export function loadMarkerArtwork(type: ItemType): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image(128, 128);
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src =
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(markerArtwork(type));
  });
}
