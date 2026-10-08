/**
 * Place categories. Generic choices come first so nothing implies a Taiwanese
 * default; the legacy cuisine and grocery values stay valid. Persisted rows
 * and seed ids refer to these names, so values are only ever added.
 */
export const placeCategories = [
  "Restaurant",
  "Cafe",
  "Bakery",
  "Dessert",
  "Breakfast",
  "Grocery",
  "Shop",
  "Park",
  "Museum",
  "Community Center",
  "Service",
  "Taiwanese",
  "Bubble Tea",
  "Hot Pot",
  "Asian Grocery",
  "Japanese",
  "Korean",
  "Chinese",
  "American",
  "Mexican",
  "Italian",
  "Indian",
  "Other",
] as const;
export type PlaceCategory = (typeof placeCategories)[number];

/**
 * Stable order that fixed place_category seed ids (uid(3, index)) were
 * generated from. Append only; never reorder.
 */
export const placeCategorySeedOrder = [
  "Taiwanese",
  "Bubble Tea",
  "Bakery",
  "Hot Pot",
  "Breakfast",
  "Dessert",
  "Asian Grocery",
  "Japanese",
  "Korean",
  "Chinese",
  "Cafe",
  "Other",
  "Restaurant",
  "Grocery",
  "Shop",
  "Park",
  "Museum",
  "Community Center",
  "Service",
  "American",
  "Mexican",
  "Italian",
  "Indian",
] as const satisfies readonly PlaceCategory[];

/** Categories that are eating and drinking places (food layer, today's food picks, popular places). */
export const foodCategories: readonly string[] = [
  "Restaurant",
  "Cafe",
  "Bakery",
  "Dessert",
  "Breakfast",
  "Taiwanese",
  "Bubble Tea",
  "Hot Pot",
  "Japanese",
  "Korean",
  "Chinese",
  "American",
  "Mexican",
  "Italian",
  "Indian",
];
/** Categories of stores that can carry product sightings. */
export const retailCategories: readonly string[] = [
  "Grocery",
  "Asian Grocery",
  "Shop",
];
export const isFoodCategory = (category: string) =>
  foodCategories.includes(category);
export const isRetailCategory = (category: string) =>
  retailCategories.includes(category);

export const placeCategoryChinese: Record<string, string> = {
  Restaurant: "餐廳",
  Cafe: "咖啡廳",
  Bakery: "麵包店",
  Dessert: "甜點",
  Breakfast: "早餐",
  Grocery: "超市",
  Shop: "商店",
  Park: "公園",
  Museum: "博物館",
  "Community Center": "社區中心",
  Service: "服務",
  Taiwanese: "台灣料理",
  "Bubble Tea": "手搖飲",
  "Hot Pot": "火鍋",
  "Asian Grocery": "亞洲超市",
  Japanese: "日式料理",
  Korean: "韓式料理",
  Chinese: "中式料理",
  American: "美式料理",
  Mexican: "墨西哥料理",
  Italian: "義式料理",
  Indian: "印度料理",
  Other: "其他",
};
