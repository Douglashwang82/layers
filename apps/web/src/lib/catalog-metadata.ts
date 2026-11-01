import type { Metadata } from "next";
import { flags } from "@/lib/config";
/**
 * The map MVP keeps the legacy catalog pages reachable but out of search
 * engines. Outside the MVP nothing changes.
 */
export function catalogMetadata(): Metadata {
  return flags.mapMvp ? { robots: { index: false } } : {};
}
