import { describe, expect, it } from "vitest";
import { isGoogleFoodPlace } from "@taiwanhub/shared";
import {
  googleTabelogLink,
  isInJapan,
  tabelogLink,
  tabelogSearchUrl,
} from "@/lib/tabelog";
const place = (over: Partial<Parameters<typeof tabelogLink>[0]> = {}) => ({
  type: "place",
  name: "すきやばし次郎",
  category: "Japanese",
  latitude: 35.6717,
  longitude: 139.7637,
  ...over,
});
describe("isInJapan", () => {
  it.each([
    ["Tokyo", 35.68, 139.65],
    ["Sapporo", 43.06, 141.35],
    ["Fukuoka", 33.59, 130.4],
    ["Shimonoseki", 33.96, 130.94],
    ["Naha", 26.21, 127.68],
    ["Osaka", 34.69, 135.5],
  ])("includes %s", (_, lat, lng) => expect(isInJapan(lat, lng)).toBe(true));
  it.each([
    ["Busan", 35.18, 129.08],
    ["Seoul", 37.57, 126.98],
    ["Taipei", 25.03, 121.57],
    ["Vladivostok", 43.12, 131.89],
    ["Houston", 29.76, -95.37],
  ])("excludes %s", (_, lat, lng) => expect(isInJapan(lat, lng)).toBe(false));
});
describe("tabelogLink", () => {
  it("searches Tabelog by the place name", () => {
    const url = new URL(tabelogLink(place())!);
    expect(url.origin + url.pathname).toBe("https://tabelog.com/rstLst/");
    expect(url.searchParams.get("sw")).toBe("すきやばし次郎");
  });
  it("encodes names with spaces and symbols", () => {
    expect(tabelogSearchUrl("A & B")).toBe(
      "https://tabelog.com/rstLst/?vs=1&sw=A%20%26%20B",
    );
  });
  it("skips places that are not food, not in Japan, unnamed or unlocated", () => {
    expect(tabelogLink(place({ category: "Museum" }))).toBeNull();
    expect(
      tabelogLink(place({ latitude: 25.03, longitude: 121.57 })),
    ).toBeNull();
    expect(tabelogLink(place({ name: "  " }))).toBeNull();
    expect(tabelogLink(place({ latitude: null }))).toBeNull();
    expect(tabelogLink(place({ type: "event" }))).toBeNull();
  });
});
describe("isGoogleFoodPlace", () => {
  it("matches eating and drinking types", () => {
    expect(isGoogleFoodPlace(["ramen_restaurant", "food"])).toBe(true);
    expect(isGoogleFoodPlace(["cafe", "store"])).toBe(true);
    expect(isGoogleFoodPlace(["bar"])).toBe(true);
  });
  it("leaves out shops and groceries", () => {
    expect(isGoogleFoodPlace(["clothing_store", "store"])).toBe(false);
    expect(isGoogleFoodPlace(["grocery_store", "food", "store"])).toBe(false);
    expect(isGoogleFoodPlace([])).toBe(false);
  });
});
describe("googleTabelogLink", () => {
  const ref = {
    name: "Jibun Doki Marunouchi",
    types: ["japanese_restaurant", "restaurant"],
    location: { lat: 35.6841, lng: 139.7659 },
  };
  it("searches by the pasted link's name", () => {
    expect(new URL(googleTabelogLink(ref)!).searchParams.get("sw")).toBe(
      "Jibun Doki Marunouchi",
    );
  });
  it("needs a name, food types and a location in Japan", () => {
    expect(googleTabelogLink({ ...ref, name: null })).toBeNull();
    expect(googleTabelogLink({ ...ref, types: null })).toBeNull();
    expect(googleTabelogLink({ ...ref, types: ["clothing_store"] })).toBeNull();
    expect(googleTabelogLink({ ...ref, location: null })).toBeNull();
    expect(
      googleTabelogLink({ ...ref, location: { lat: 25.03, lng: 121.57 } }),
    ).toBeNull();
  });
});
