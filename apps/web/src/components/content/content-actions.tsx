"use client";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Bookmark } from "lucide-react";
import { api, StatusMessage } from "@/components/actions";
import type { Copy } from "@/lib/dictionary";
/** Content saves use their own persistence path; the button mirrors catalog Save semantics. */
export function ContentSaveButton({
  id,
  saved,
  authenticated,
  t,
}: {
  id: string;
  saved: boolean;
  authenticated: boolean;
  t: Copy;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(saved);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  return (
    <>
      <button
        type="button"
        className={`button secondary ${state ? "active" : ""}`}
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={async () => {
          if (!authenticated) {
            router.push("/sign-in?next=" + encodeURIComponent(pathname));
            return;
          }
          setPending(true);
          try {
            const result = await api(
              `content/${id}/save`,
              state ? "DELETE" : "POST",
            );
            setState(result.saved);
          } catch (e) {
            setFeedback({ tone: "error", text: (e as Error).message });
          } finally {
            setPending(false);
          }
        }}
      >
        <Bookmark size={16} aria-hidden="true" />
        {pending ? t.saving : state ? t.unsave : t.save}
      </button>
      <StatusMessage feedback={feedback} />
    </>
  );
}
