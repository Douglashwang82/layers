"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { accountPanelHref } from "@/lib/account-panel";

/**
 * Sign-in that returns to the open account sidebar over the map state on
 * screen now: the map changes its URL with pushState, so a server-built link
 * would be stale.
 */
export function AccountSignInLink({ label }: { label: string }) {
  const params = useSearchParams();
  const next = accountPanelHref(params.toString());
  return (
    <Link className="button" href={`/sign-in?${new URLSearchParams({ next })}`}>
      {label}
    </Link>
  );
}
