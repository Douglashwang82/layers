"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import { folderPanelHref } from "@/lib/layer-workspace";

/** Opens a folder's panel in the map workspace, keeping the map's own URL state. */
export function FolderLink({
  slug,
  children,
  ...props
}: { slug: string; children: ReactNode } & Omit<
  ComponentProps<typeof Link>,
  "href"
>) {
  const params = useSearchParams();
  return (
    <Link
      {...props}
      href={folderPanelHref(slug, params.toString())}
      scroll={false}
    >
      {children}
    </Link>
  );
}
