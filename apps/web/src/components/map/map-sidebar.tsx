"use client";
import type { ReactNode, Ref, UIEventHandler } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, X } from "lucide-react";
import { LayerLink as Link } from "../layers/workspace-navigation";
import type { Copy } from "@/lib/dictionary";

/** Labels the open screen's section from the panel header's title. */
export const panelTitleId = "map-panel-title";

export type PanelBack = { label: string } & (
  { onClick: () => void; href?: never } | { href: string; onClick?: never }
);

/**
 * The floating panel's shell, the same on every screen: a fixed header with
 * the way back, the title and the panel's own controls, then one scrolling
 * area ending in the About footer. Screens only supply their content.
 */
export function MapSidebar({
  title,
  count,
  back,
  sheet,
  onSheet,
  onClose,
  notice,
  announce,
  footer,
  scrollRef,
  onScroll,
  t,
  children,
}: {
  /** Omitted where the content leads with its own title. */
  title?: string;
  count?: number;
  back?: PanelBack;
  sheet: "half" | "expanded";
  onSheet: (sheet: "half" | "expanded") => void;
  /** Omitted when the panel cannot be hidden. */
  onClose?: () => void;
  /** Messages about the whole workspace; they stay put while the list scrolls. */
  notice?: ReactNode;
  announce: string;
  footer: ReactNode;
  scrollRef: Ref<HTMLDivElement>;
  onScroll: UIEventHandler<HTMLDivElement>;
  t: Copy;
  children: ReactNode;
}) {
  // With a title next to it the arrow is enough; alone it says where it goes.
  const backContent = (
    <>
      <ArrowLeft size={18} aria-hidden="true" />
      {!title && <span>{back?.label}</span>}
    </>
  );
  const backProps = {
    className: `panel-back${title ? " icon-only" : ""}`,
    "aria-label": title ? back?.label : undefined,
    title: title ? back?.label : undefined,
  };
  return (
    <div id="map-sidebar-content" className="map-sidebar-content">
      <header className="panel-header">
        {back &&
          (back.href ? (
            <Link {...backProps} href={back.href}>
              {backContent}
            </Link>
          ) : (
            <button {...backProps} type="button" onClick={back.onClick}>
              {backContent}
            </button>
          ))}
        <span className="panel-title">
          {title && <h2 id={panelTitleId}>{title}</h2>}
          {title && count !== undefined && (
            <span className="count-pill">{count}</span>
          )}
        </span>
        <span className="panel-controls">
          <button
            type="button"
            className="icon-button sheet-toggle"
            aria-label={sheet === "half" ? t.expand : t.shrinkPanel}
            onClick={() => onSheet(sheet === "half" ? "expanded" : "half")}
          >
            {sheet === "half" ? (
              <ChevronUp size={18} aria-hidden="true" />
            ) : (
              <ChevronDown size={18} aria-hidden="true" />
            )}
          </button>
          {onClose && (
            <button
              type="button"
              className="icon-button"
              aria-label={t.hideLayers}
              title={t.hideLayers}
              onClick={onClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </span>
      </header>
      {notice && <div className="panel-notice">{notice}</div>}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      <div
        ref={scrollRef}
        className="panel-scroll"
        tabIndex={-1}
        onScroll={onScroll}
      >
        {children}
        {footer}
      </div>
    </div>
  );
}
