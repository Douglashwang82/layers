/**
 * Product identity. The internal `taiwanhub` names (workspace packages, storage
 * keys, cryptographic purposes, database and infrastructure names) are legacy
 * technical identifiers kept for compatibility; see
 * docs/plans/locallink-rebrand-implementation-plan.md.
 */
export const brand = {
  name: "LocalLink",
  tagline: "Local places, events, products and communities for everyone",
  taglineChinese: "為每個人打造的在地好去處、活動、好物與社群",
  /** Legacy default title of the system food layer, kept only for display normalization. */
  legacyFoodLayerTitle: "Taiwanese food favorites",
  legacyFoodLayerTitleChinese: "台灣人的美食愛店",
  foodLayerTitle: "Local food favorites",
  foodLayerTitleChinese: "在地美食愛店",
} as const;

/**
 * Display normalization for system-layer titles persisted before the rename.
 * Only the exact legacy default label of a system food layer is replaced;
 * user, group and custom titles are never touched.
 */
export function normalizeSystemLayerTitles<
  L extends {
    ownerKind: string;
    title: string;
    titleChinese: string;
    rule?: { kind?: string } | null;
  },
>(layer: L): L {
  if (layer.ownerKind !== "system" || layer.rule?.kind !== "food") return layer;
  const title =
    layer.title === brand.legacyFoodLayerTitle
      ? brand.foodLayerTitle
      : layer.title;
  const titleChinese =
    layer.titleChinese === brand.legacyFoodLayerTitleChinese
      ? brand.foodLayerTitleChinese
      : layer.titleChinese;
  return title === layer.title && titleChinese === layer.titleChinese
    ? layer
    : { ...layer, title, titleChinese };
}
