import { describe, expect, it } from "vitest";
import {
  brand,
  foodCategories,
  isFoodCategory,
  isRetailCategory,
  normalizeSystemLayerTitles,
  placeCategories,
  placeCategoryChinese,
  placeCategorySeedOrder,
  placeInput,
  renderDailyPickReasons,
  retailCategories,
} from "../../packages/shared/src";
import {
  invitationEmail,
  resetPasswordEmail,
  signInCodeEmail,
} from "../../packages/shared/src/mail";
import { en, zh } from "../../apps/web/src/lib/dictionary";

const legacyCategories = [
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
];

describe("place categories", () => {
  it("keeps every legacy category valid and adds generic ones", () => {
    for (const category of legacyCategories)
      expect(placeCategories).toContain(category);
    for (const category of ["Restaurant", "Grocery", "Shop", "Park", "Museum"])
      expect(placeCategories).toContain(category);
    expect(placeCategories).toContain("Community Center");
    expect(placeCategories).toContain("Service");
    expect(placeCategories[0]).toBe("Restaurant");
    expect(new Set(placeCategories).size).toBe(placeCategories.length);
  });
  it("validates generic and legacy values at the shared boundary", () => {
    const accepts = (category: string) =>
      placeInput.shape.category.safeParse(category).success;
    for (const category of ["Park", "Service", "Taiwanese", "Asian Grocery"])
      expect(accepts(category)).toBe(true);
    expect(accepts("Not a category")).toBe(false);
  });
  it("keeps seed ids stable: legacy order first, every category covered once", () => {
    expect(placeCategorySeedOrder.slice(0, legacyCategories.length)).toEqual(
      legacyCategories.map((c) => c),
    );
    expect([...placeCategorySeedOrder].sort()).toEqual(
      [...placeCategories].sort(),
    );
  });
  it("has a Traditional Chinese label for each category", () => {
    for (const category of placeCategories)
      expect(placeCategoryChinese[category]).toBeTruthy();
  });
  it("only eating and drinking places count as food", () => {
    for (const category of ["Restaurant", "Cafe", "Taiwanese", "Mexican"])
      expect(isFoodCategory(category)).toBe(true);
    for (const category of [
      "Park",
      "Museum",
      "Service",
      "Community Center",
      "Shop",
      "Grocery",
      "Asian Grocery",
      "Other",
      "Unknown",
    ])
      expect(isFoodCategory(category)).toBe(false);
    expect(
      foodCategories.every((c) => placeCategories.includes(c as never)),
    ).toBe(true);
  });
  it("sightings accept general and legacy stores only", () => {
    for (const category of ["Grocery", "Shop", "Asian Grocery"])
      expect(isRetailCategory(category)).toBe(true);
    for (const category of ["Park", "Service", "Restaurant", "Museum", "Other"])
      expect(isRetailCategory(category)).toBe(false);
    expect(
      retailCategories.every((c) => placeCategories.includes(c as never)),
    ).toBe(true);
  });
});

describe("system layer title compatibility", () => {
  const food = {
    ownerKind: "system",
    title: brand.legacyFoodLayerTitle,
    titleChinese: brand.legacyFoodLayerTitleChinese,
    rule: { kind: "food" },
  };
  it("relabels the exact legacy default of a system food layer", () => {
    const layer = normalizeSystemLayerTitles(food);
    expect(layer.title).toBe("Local food favorites");
    expect(layer.titleChinese).toBe("在地美食愛店");
  });
  it("never relabels custom, user, group or other system layers", () => {
    const custom = {
      ...food,
      title: "Taiwanese food favorites (mine)",
      titleChinese: "我的美食",
    };
    expect(normalizeSystemLayerTitles(custom)).toBe(custom);
    const user = { ...food, ownerKind: "user" };
    expect(normalizeSystemLayerTitles(user)).toBe(user);
    const group = { ...food, ownerKind: "group" };
    expect(normalizeSystemLayerTitles(group)).toBe(group);
    const discover = { ...food, rule: { kind: "discover" } };
    expect(normalizeSystemLayerTitles(discover)).toBe(discover);
    const edited = { ...food, title: "Renamed", titleChinese: "改名" };
    expect(normalizeSystemLayerTitles(edited)).toBe(edited);
  });
  it("is idempotent on already renamed layers", () => {
    const renamed = {
      ...food,
      title: brand.foodLayerTitle,
      titleChinese: brand.foodLayerTitleChinese,
    };
    expect(normalizeSystemLayerTitles(renamed)).toBe(renamed);
  });
});

describe("LocalLink branding", () => {
  it("names the product LocalLink in emails and editor copy", () => {
    expect(brand.name).toBe("LocalLink");
    const emails = [
      invitationEmail("https://example.test/join", new Date()),
      resetPasswordEmail("https://example.test/reset"),
      signInCodeEmail("123456"),
    ];
    for (const mail of emails) {
      expect(mail.subject).toContain("LocalLink");
      expect(mail.subject + mail.text).not.toMatch(/TaiwanHub/);
    }
    expect(
      renderDailyPickReasons(
        [{ code: "editorial", note: "", noteChinese: "" }],
        "en",
      ),
    ).toBe("Chosen by the LocalLink editors.");
  });
  it("has no Taiwan-only audience or old brand in either dictionary", () => {
    const text = JSON.stringify({ en, zh });
    expect(text).not.toMatch(/TaiwanHub/);
    for (const [key, value] of Object.entries({ ...en, ...zh })) {
      if (typeof value !== "string") continue;
      expect(value, key).not.toMatch(/Taiwanese (eyes|friends|score|heart)/);
      expect(value, key).not.toMatch(/台灣(朋友|人的|心)/);
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});
