import { describe, expect, it } from "vitest";
import {
  appliedSlots,
  collectionInput,
  collectionPatchInput,
  fitSlots,
  maxAppliedLayers,
  parseMapQuery,
  serializeMapQuery,
} from "../../packages/shared/src";
import { collectionAccessFor } from "../../apps/web/src/features/layers/collections-repository";
import type { CollectionRecord } from "../../apps/web/src/features/layers/collections-repository";

describe("folder slots", () => {
  it("counts every applied layer and folder", () => {
    expect(appliedSlots(["a", "b"], ["f"])).toBe(3);
    expect(appliedSlots("none", ["f"])).toBe(1);
    expect(appliedSlots(undefined, undefined)).toBe(0);
  });
  it("trims folders, never layers, to the slots left", () => {
    const state = fitSlots({
      layers: ["a", "b", "c", "d"],
      collections: ["f", "g"],
    });
    expect(state.layers).toHaveLength(4);
    expect(state.collections).toEqual(["f"]);
    expect(
      fitSlots({ layers: "none" as const, collections: ["f", "g", "h"] })
        .collections,
    ).toEqual(["f", "g", "h"]);
    expect(
      (fitSlots({ layers: ["a"] }) as { collections?: string[] }).collections,
    ).toBeUndefined();
    const full = fitSlots({
      layers: ["a", "b", "c", "d", "e"],
      collections: ["f"],
    });
    expect(full.collections).toEqual([]);
    expect(appliedSlots(full.layers, full.collections)).toBeLessThanOrEqual(
      maxAppliedLayers,
    );
  });
});

describe("collections in the map URL", () => {
  it("leaves collections undefined when absent", () => {
    expect(parseMapQuery({}).collections).toBeUndefined();
  });
  it("dedupes, drops bad slugs and caps at three", () => {
    expect(
      parseMapQuery({ collections: "a,b,a,Bad Slug,c,d" }).collections,
    ).toEqual(["a", "b", "c"]);
  });
  it("keeps layers and trims collections to fit", () => {
    const parsed = parseMapQuery({
      layers: "l1,l2,l3,l4",
      collections: "f1,f2",
    });
    expect(parsed.layers).toHaveLength(4);
    expect(parsed.collections).toEqual(["f1"]);
  });
  it("serializes folders only when present", () => {
    expect(serializeMapQuery({ collections: ["a", "b"] })).toBe(
      "?collections=a%2Cb",
    );
    expect(serializeMapQuery({ collections: [] })).toBe("");
  });
});

describe("collectionInput", () => {
  const base = { title: "Trip", city: "houston" };
  it("accepts a private folder and a sub-folder without group data", () => {
    expect(collectionInput.parse(base).audience).toBe("private");
    expect(
      collectionInput.safeParse({
        ...base,
        audience: "group",
        parentId: crypto.randomUUID(),
      }).success,
    ).toBe(true);
  });
  it("requires a group id for a top-level group folder", () => {
    expect(
      collectionInput.safeParse({ ...base, audience: "group" }).success,
    ).toBe(false);
    expect(
      collectionInput.safeParse({
        ...base,
        audience: "group",
        groupId: crypto.randomUUID(),
      }).success,
    ).toBe(true);
  });
  it("bounds titles by characters and bytes", () => {
    expect(
      collectionInput.safeParse({ ...base, title: "x".repeat(121) }).success,
    ).toBe(false);
    expect(
      collectionInput.safeParse({ ...base, title: "字".repeat(120) }).success,
    ).toBe(true);
    expect(
      collectionInput.safeParse({ ...base, title: "😀".repeat(121) }).success,
    ).toBe(false);
    expect(collectionInput.safeParse({ ...base, title: "" }).success).toBe(
      false,
    );
  });
  it("requires a revision on patches and bounds the order list", () => {
    expect(collectionPatchInput.safeParse({ title: "x" }).success).toBe(false);
    expect(
      collectionPatchInput.safeParse({ revision: 1, parentId: null }).success,
    ).toBe(true);
    expect(
      collectionPatchInput.safeParse({
        revision: 1,
        order: Array.from({ length: 201 }, () => ({
          kind: "layer",
          id: crypto.randomUUID(),
        })),
      }).success,
    ).toBe(false);
  });
});

describe("collectionAccessFor", () => {
  const rec = (over: Partial<CollectionRecord>): CollectionRecord => ({
    id: "f",
    slug: "f",
    title: "F",
    titleChinese: "",
    description: "",
    descriptionChinese: "",
    cityId: "c",
    citySlug: "houston",
    ownerKind: "user",
    ownerUserId: "u1",
    ownerGroupId: null,
    ownerName: "",
    parentId: null,
    depth: 1,
    position: 0,
    audience: "private",
    reviewStatus: "unsubmitted",
    lifecycle: "active",
    revision: 1,
    sourceUrl: "",
    ...over,
  });
  it("gives the user owner everything and strangers nothing", () => {
    expect(
      collectionAccessFor(rec({}), { id: "u1", role: "USER" }, new Map()),
    ).toMatchObject({ view: true, edit: true, manage: true });
    expect(
      collectionAccessFor(rec({}), { id: "u2", role: "USER" }, new Map()),
    ).toMatchObject({ view: false, edit: false, manage: false });
    expect(collectionAccessFor(rec({}), null, new Map()).view).toBe(false);
  });
  it("maps group roles", () => {
    const group = rec({
      ownerKind: "group",
      ownerUserId: null,
      ownerGroupId: "g",
    });
    const actor = { id: "u2", role: "USER" as const };
    const as = (role: "owner" | "editor" | "viewer") =>
      collectionAccessFor(group, actor, new Map([["g", role]]));
    expect(as("viewer")).toMatchObject({
      view: true,
      edit: false,
      manage: false,
    });
    expect(as("editor")).toMatchObject({
      view: true,
      edit: true,
      manage: false,
    });
    expect(as("owner")).toMatchObject({ view: true, edit: true, manage: true });
  });
});
