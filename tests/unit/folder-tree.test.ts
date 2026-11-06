import { describe, expect, it } from "vitest";
import type {
  CollectionChild,
  CollectionNode,
} from "@/features/layers/collections-types";
import { folderLayers } from "@/lib/folder-tree";

const layer = (slug: string) =>
  ({ kind: "layer", layer: { id: slug, slug } }) as CollectionChild;
const sub = (...children: CollectionChild[]): CollectionChild => ({
  kind: "folder",
  folder: { children } as unknown as CollectionNode,
});
const folder = (...children: CollectionChild[]) =>
  ({ children }) as unknown as CollectionNode;

describe("folderLayers", () => {
  it("collects layers from every depth of the subtree", () => {
    const tree = folder(layer("a"), sub(layer("b")), sub(sub(layer("c"))));
    expect(folderLayers(tree).map((l) => l.slug)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for an empty folder", () => {
    expect(folderLayers(folder())).toEqual([]);
  });
});
