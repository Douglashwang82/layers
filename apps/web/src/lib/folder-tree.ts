import type {
  CollectionLayerChild,
  CollectionNode,
} from "@/features/layers/collections-types";

/** Every layer filed anywhere in the folder's subtree; repeats are kept. */
export function folderLayers(folder: CollectionNode): CollectionLayerChild[] {
  return folder.children.flatMap((child) =>
    child.kind === "layer" ? [child.layer] : folderLayers(child.folder),
  );
}
