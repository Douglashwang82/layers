import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  appUrl: "https://example.test",
  flags: {},
}));

import { isDisabledSystemLayer } from "@/features/layers/repository";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { catalogMetadata } from "@/lib/catalog-metadata";

describe("system layers", () => {
  const system = (kind: string) => ({
    ownerKind: "system" as const,
    rule: { kind } as never,
  });
  it("keeps only the Daily Pick", () => {
    expect(isDisabledSystemLayer(system("daily_pick"))).toBe(false);
    expect(isDisabledSystemLayer(system("saves"))).toBe(true);
    expect(isDisabledSystemLayer(system("upcoming"))).toBe(true);
    expect(isDisabledSystemLayer({ ownerKind: "system", rule: null })).toBe(
      true,
    );
  });
  it("disables another city's Daily Pick but keeps the active city's", () => {
    const pick = { ...system("daily_pick"), cityId: "houston" };
    expect(isDisabledSystemLayer(pick, "houston")).toBe(false);
    expect(isDisabledSystemLayer(pick, "taipei")).toBe(true);
  });
  it("never disables user or group layers", () => {
    expect(isDisabledSystemLayer({ ownerKind: "user", rule: null })).toBe(
      false,
    );
    expect(isDisabledSystemLayer({ ownerKind: "group", rule: null })).toBe(
      false,
    );
  });
});

describe("legacy catalog", () => {
  it("lists only the home URL in the sitemap", () => {
    expect(sitemap().map((e) => e.url)).toEqual(["https://example.test"]);
  });
  it("marks catalog pages noindex", () => {
    expect(catalogMetadata()).toEqual({ robots: { index: false } });
  });
  it("keeps search out of crawlers", () => {
    const rules = robots().rules as { disallow: string[] };
    expect(rules.disallow).toContain("/search");
  });
  it("blocks shared-link paths for crawlers", () => {
    const rules = robots().rules as { disallow: string[] };
    expect(rules.disallow).toContain("/shared/");
  });
});
