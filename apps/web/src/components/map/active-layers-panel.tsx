"use client";
import { useId, useState } from "react";
import { LayerLink as Link } from "../layers/workspace-navigation";
import {
  ChevronRight,
  Folder as FolderIcon,
  Plus,
  Layers as LayersIcon,
} from "lucide-react";
import { FolderLink } from "../layers/folder-link";
import type { LayerAvailability } from "@/features/map/query";
import type { CollectionNode } from "@/features/layers/collections-types";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { maxAppliedCollections, maxAppliedLayers } from "@taiwanhub/shared";
import { layerTitle, ownerLabel, scheduleLabel } from "@/lib/layer-labels";

function folderName(folder: CollectionNode, locale: Locale) {
  return locale === "zh-TW" && folder.titleChinese
    ? folder.titleChinese
    : folder.title;
}

/** Distinct layer ids anywhere in the folder's subtree. */
function subtreeLayerCount(folder: CollectionNode) {
  const ids = new Set<string>();
  const walk = (node: CollectionNode) => {
    for (const child of node.children) {
      if (child.kind === "layer") ids.add(child.layer.id);
      else walk(child.folder);
    }
  };
  walk(folder);
  return ids.size;
}

/**
 * One folder in the tree. A folder goes on the map as a unit; when it is
 * applied its descendants are already included, so their own checkboxes show
 * as included and disabled.
 */
function FolderItem({
  folder,
  included,
  appliedFolders,
  slotsFull,
  t,
  locale,
  onToggleFolder,
  onOnly,
}: {
  folder: CollectionNode;
  included: boolean;
  appliedFolders: string[];
  slotsFull: boolean;
  t: Copy;
  locale: Locale;
  onToggleFolder: (slug: string, applied: boolean) => void;
  onOnly: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const groupId = useId();
  const title = folderName(folder, locale);
  const own = appliedFolders.includes(folder.slug);
  const inherited = included && !own;
  const checked = own || included;
  const hasChildren = folder.children.length > 0;
  const layerCount = subtreeLayerCount(folder);
  const full =
    !checked && (slotsFull || appliedFolders.length >= maxAppliedCollections);
  return (
    <li className="folder-item">
      <div className="layer-toggle folder-row">
        {hasChildren ? (
          <button
            type="button"
            className="text-button folder-disclosure"
            aria-label={format(open ? t.folderCollapse : t.folderExpand, {
              title,
            })}
            aria-expanded={open}
            aria-controls={groupId}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight
              size={16}
              aria-hidden="true"
              style={{ transform: open ? "rotate(90deg)" : undefined }}
            />
          </button>
        ) : (
          <span className="folder-disclosure" aria-hidden="true" />
        )}
        <input
          type="checkbox"
          checked={checked}
          aria-label={format(t.folderShowOnMap, { title })}
          title={inherited ? t.folderIncludedInParent : undefined}
          disabled={inherited || full}
          onChange={(e) => onToggleFolder(folder.slug, e.target.checked)}
        />
        <span className="layer-text">
          <span className="layer-title">
            <FolderIcon size={14} aria-hidden="true" /> {title}
          </span>
          <span className="layer-meta">
            {format(t.folderLayerCount, { count: layerCount })}
            {folder.hiddenCount > 0 &&
              ` · ${format(t.folderHiddenCount, { count: folder.hiddenCount })}`}
          </span>
        </span>
        <FolderLink className="text-button" slug={folder.slug}>
          {t.folderOpen}
        </FolderLink>
      </div>
      {open && hasChildren && (
        <ul id={groupId} className="folder-group">
          {folder.children.map((child) =>
            child.kind === "folder" ? (
              <FolderItem
                key={`f:${child.folder.id}`}
                folder={child.folder}
                included={checked}
                appliedFolders={appliedFolders}
                slotsFull={slotsFull}
                t={t}
                locale={locale}
                onToggleFolder={onToggleFolder}
                onOnly={onOnly}
              />
            ) : (
              <li key={`l:${child.layer.id}`} className="folder-layer">
                <span className="layer-title">
                  <Link href={`/layers/${child.layer.slug}`}>
                    {locale === "zh-TW" && child.layer.titleChinese
                      ? child.layer.titleChinese
                      : child.layer.title}
                  </Link>
                </span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onOnly(child.layer.slug)}
                >
                  {t.showOnlyThis}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * Applied layers with their checkbox, owner, schedule, availability and the
 * count they contribute to the current query. Hidden layers stay listed for
 * the session so hiding is reversible without a trip to the library. The
 * member's folders sit above them and share the same map slots.
 */
export function ActiveLayersPanel({
  layers,
  hidden,
  library,
  folders = [],
  appliedFolders = [],
  onToggleFolder,
  t,
  locale,
  refreshing,
  onToggle,
  onOnly,
}: {
  layers: LayerAvailability[];
  hidden: LayerAvailability[];
  /**
   * Map MVP: the member's own, group and followed layers, listed so any of
   * them can be loaded here; null when the picker is the library page.
   */
  library?: LayerAvailability[] | null;
  /** The member's top-level folders with their trees. */
  folders?: CollectionNode[];
  /** Slugs of the folders on the map. */
  appliedFolders?: string[];
  onToggleFolder?: (slug: string, applied: boolean) => void;
  t: Copy;
  locale: Locale;
  refreshing: boolean;
  onToggle: (slug: string, applied: boolean) => void;
  onOnly: (slug: string) => void;
}) {
  const applied = layers.length;
  const used = applied + appliedFolders.length;
  const slotsFull = used >= maxAppliedLayers;
  const listed = new Set([...layers, ...hidden].map((l) => l.slug));
  const rows = [
    ...layers.map((l) => ({ layer: l, applied: true })),
    ...hidden.map((l) => ({ layer: l, applied: false })),
    ...(library ?? [])
      .filter((l) => !listed.has(l.slug))
      .map((l) => ({ layer: l, applied: false })),
  ];
  const showFolders = folders.length > 0 && !!onToggleFolder;
  return (
    <section className="active-layers" aria-labelledby="active-layers-heading">
      <div className="panel-heading">
        <h2 id="active-layers-heading">
          <LayersIcon size={18} aria-hidden="true" />
          {library ? t.yourLayers : t.onYourMap}
        </h2>
        <span className="count-pill">{used}</span>
      </div>
      {showFolders && (
        <>
          <h3 id="folder-tree-heading" className="folder-heading">
            {t.folders}
          </h3>
          <ul aria-labelledby="folder-tree-heading" className="folder-tree">
            {folders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                included={false}
                appliedFolders={appliedFolders}
                slotsFull={slotsFull}
                t={t}
                locale={locale}
                onToggleFolder={onToggleFolder}
                onOnly={onOnly}
              />
            ))}
          </ul>
        </>
      )}
      {rows.length === 0 && !showFolders && (
        <p className="muted">{library ? t.noLayersYet : t.chooseLayer}</p>
      )}
      <ul className="layer-rows">
        {rows.map(({ layer, applied: isApplied }) => (
          <li key={layer.slug} className={`layer-row status-${layer.status}`}>
            <div className="layer-toggle">
              <input
                type="checkbox"
                checked={isApplied}
                aria-label={`${t.showOnMap}: ${layerTitle(layer, locale)}`}
                disabled={
                  layer.status === "unavailable" || (!isApplied && slotsFull)
                }
                onChange={(e) => onToggle(layer.slug, e.target.checked)}
                aria-describedby={`layer-${layer.slug}-meta`}
              />
              <span className="layer-text">
                <span className="layer-title">
                  {layer.status === "unavailable" ? (
                    t.layerUnavailable
                  ) : (
                    <Link href={`/layers/${layer.slug}`}>
                      {layerTitle(layer, locale)}
                    </Link>
                  )}
                </span>
                <span className="layer-meta" id={`layer-${layer.slug}-meta`}>
                  {layer.status === "ok"
                    ? `${ownerLabel(layer, t, false)} · ${scheduleLabel(layer, t, locale)}`
                    : ""}
                </span>
              </span>
              {layer.status === "ok" && (
                <span
                  className="layer-count th-tabular"
                  aria-busy={refreshing || undefined}
                >
                  {isApplied ? layer.count : t.layerNotApplied}
                </span>
              )}
            </div>
            {layer.status === "ok" && (
              <span className="layer-actions">
                <Link className="text-button" href={`/layers/${layer.slug}`}>
                  {t.viewLayer}
                </Link>
                {isApplied && used > 1 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onOnly(layer.slug)}
                  >
                    {t.showOnlyThis}
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {(showFolders || appliedFolders.length > 0) && (
        <p className="fine-print" role="status">
          {format(t.folderSlots, { used, max: maxAppliedLayers })}
        </p>
      )}
      {slotsFull && (
        <p className="fine-print">
          {format(t.layerLimit, { max: maxAppliedLayers })}
        </p>
      )}
      {library && (
        <Link className="button small find-layers" href="/layers/new">
          <Plus size={16} aria-hidden="true" />
          {t.createFromGoogle}
        </Link>
      )}
      <Link className="button secondary small find-layers" href="/layers">
        {!library && <Plus size={16} aria-hidden="true" />}
        {t.findLayers}
      </Link>
    </section>
  );
}
