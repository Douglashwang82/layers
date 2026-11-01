import type { Metadata } from "next";
/** The legacy catalog pages stay reachable but out of search engines. */
export function catalogMetadata(): Metadata {
  return { robots: { index: false } };
}
