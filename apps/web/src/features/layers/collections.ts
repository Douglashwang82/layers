import type { Actor } from "@taiwanhub/shared";
import type { CollectionNode } from "./collections-types";

/**
 * STUB for the folders UI slice. The service slice replaces this file with the
 * real implementation (same signature); drop this one when merging.
 */
export async function listMapCollections(
  actor: Actor,
  city: { id: string; slug: string; name: string; timezone: string },
): Promise<CollectionNode[]> {
  void actor;
  void city;
  return [];
}
