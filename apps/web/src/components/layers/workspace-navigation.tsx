"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { layerWorkspaceHref, withoutLayerPanel } from "@/lib/layer-workspace";

export const LayerWorkspaceContext = createContext<{
  apply: (slug: string, only: boolean) => void;
  pinCenter: () => { latitude: number; longitude: number } | null;
  mapReady: boolean;
  selectItem: (key: string, slug: string) => void;
  deleted: (slug: string) => void;
  applied: string[];
  /** Folders on the map; they take slots alongside layers. */
  appliedFolders?: number;
  /** Put a folder on the map by itself and return to the results. */
  showFolder?: (slug: string) => void;
} | null>(null);

/** Navigation guards belong to the draft, including links outside its form. */
export function useLayerDraft(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: Event) => {
      if (!window.confirm(message)) event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("a[href]")
      )
        return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("layer:before-leave", leave);
    document.addEventListener("click", click, true);
    window.addEventListener("beforeunload", unload);
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation;
    const traverse = (event: Event) => {
      if (
        (event as Event & { navigationType?: string }).navigationType ===
          "traverse" &&
        event.cancelable
      )
        leave(event);
    };
    navigation?.addEventListener("navigate", traverse);
    return () => {
      window.removeEventListener("layer:before-leave", leave);
      document.removeEventListener("click", click, true);
      window.removeEventListener("beforeunload", unload);
      navigation?.removeEventListener("navigate", traverse);
    };
  }, [dirty, message]);
}

export function useLayerRouter() {
  const router = useRouter();
  const workspace = useContext(LayerWorkspaceContext);
  return {
    ...router,
    push(href: string) {
      router.push(
        workspace ? layerWorkspaceHref(href, window.location.search) : href,
        { scroll: false },
      );
    },
  };
}

export function LayerLink({ href, ...props }: ComponentProps<typeof Link>) {
  const workspace = useContext(LayerWorkspaceContext);
  const router = useRouter();
  const params = useSearchParams();
  const integrated = !!workspace;
  const resolved =
    integrated && typeof href === "string"
      ? href === "/"
        ? withoutLayerPanel(params.toString())
        : layerWorkspaceHref(href, params.toString())
      : href;
  return (
    <Link
      {...props}
      href={resolved}
      scroll={integrated ? false : props.scroll}
      onNavigate={(event) => {
        props.onNavigate?.(event);
        if (
          !integrated ||
          typeof href !== "string" ||
          (href !== "/" && !/^\/layers(?:[/?]|$)/.test(href))
        )
          return;
        event.preventDefault();
        router.push(
          href === "/"
            ? withoutLayerPanel(window.location.search)
            : layerWorkspaceHref(href, window.location.search),
          { scroll: false },
        );
      }}
    />
  );
}

export function LayerSearchForm({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const router = useLayerRouter();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const [key, value] of data)
      if (typeof value === "string") params.set(key, value);
    router.push("/layers?" + params.toString());
  }
  return (
    <form
      className={className}
      action="/layers"
      role="search"
      onSubmit={submit}
    >
      {children}
    </form>
  );
}
