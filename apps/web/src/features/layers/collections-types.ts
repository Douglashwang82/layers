/*
 * Folder ("layer collection") shapes shared by the server and client
 * components. Types only: no server imports, so client code may import this.
 */

export type CollectionLayerChild = {
  id: string;
  slug: string;
  title: string;
  titleChinese: string;
  ownerName: string;
  /** The layer's total item count, not a map-query contribution. */
  count: number;
};

export type CollectionChild =
  | { kind: "folder"; folder: CollectionNode }
  | { kind: "layer"; layer: CollectionLayerChild };

export type CollectionNode = {
  id: string;
  slug: string;
  title: string;
  titleChinese: string;
  description: string;
  descriptionChinese: string;
  citySlug: string;
  depth: number;
  parentId: string | null;
  revision: number;
  ownerKind: "user" | "group";
  ownerGroupId: string | null;
  ownerName: string;
  audience: "private" | "group" | "public";
  canEdit: boolean;
  canManage: boolean;
  /** Direct children in position order; layers the viewer cannot see are left out. */
  children: CollectionChild[];
  /** Direct child layers left out because this viewer cannot see them. */
  hiddenCount: number;
};

/** A layer that may be added to a folder. */
export type CollectionCandidate = {
  id: string;
  slug: string;
  title: string;
  titleChinese: string;
  ownerName: string;
};

/** An applied folder in a map query result. */
export type CollectionAvailability = {
  slug: string;
  /** Absent when unavailable. */
  id?: string;
  /** Blank when unavailable, like an unavailable layer. */
  title: string;
  titleChinese: string;
  status: "ok" | "unavailable";
  /** Layers expanded from this folder that resolved for this viewer, in tree order. */
  layerSlugs: string[];
  hiddenCount: number;
  /** More layers were visible than `maxExpandedLayers` allowed. */
  truncated: boolean;
  /** Items this folder's layers contributed to the current query. */
  count: number;
};
