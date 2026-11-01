import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  flags: { mapMvp: true },
  rows: [] as unknown[],
}));
vi.mock("@/lib/config", () => ({
  appUrl: "https://example.test",
  flags: state.flags,
}));
vi.mock("@taiwanhub/database", () => ({
  pool: { query: vi.fn(async () => ({ rows: state.rows })) },
}));

import { isDisabledSystemLayer } from "@/features/layers/repository";
import { navigationHrefs } from "@/components/navigation";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { catalogMetadata } from "@/lib/catalog-metadata";

beforeEach(() => {
  state.flags.mapMvp = true;
  state.rows = [{ slug: "a-place", updated_at: new Date("2026-01-01") }];
});

describe("system layers under the map MVP", () => {
  const system = (kind: string) => ({
    ownerKind: "system" as const,
    rule: { kind } as never,
  });
  it("keeps only the Daily Pick", () => {
    expect(isDisabledSystemLayer(system("daily_pick"), true)).toBe(false);
    expect(isDisabledSystemLayer(system("saves"), true)).toBe(true);
    expect(isDisabledSystemLayer(system("upcoming"), true)).toBe(true);
    expect(
      isDisabledSystemLayer({ ownerKind: "system", rule: null }, true),
    ).toBe(true);
  });
  it("never disables user or group layers, nor anything outside the MVP", () => {
    expect(isDisabledSystemLayer({ ownerKind: "user", rule: null }, true)).toBe(
      false,
    );
    expect(isDisabledSystemLayer(system("saves"), false)).toBe(false);
  });
});

describe("legacy catalog under the map MVP", () => {
  it("drops /saved from the navigation", () => {
    expect(navigationHrefs(true)).toEqual(["/", "/layers", "/profile"]);
    expect(navigationHrefs(false)).toContain("/saved");
  });
  it("lists only the home URL in the sitemap", async () => {
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toEqual(["https://example.test"]);
  });
  it("still lists catalog pages outside the MVP", async () => {
    state.flags.mapMvp = false;
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/a-place"))).toBe(true);
  });
  it("marks catalog pages noindex only under the MVP", () => {
    expect(catalogMetadata()).toEqual({ robots: { index: false } });
    state.flags.mapMvp = false;
    expect(catalogMetadata()).toEqual({});
  });
  it("blocks shared-link paths for crawlers", () => {
    const rules = robots().rules as { disallow: string[] };
    expect(rules.disallow).toContain("/shared/");
  });
});
