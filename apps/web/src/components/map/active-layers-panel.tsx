"use client";
import { useId, useState } from "react";
import { LayerLink as Link } from "../layers/workspace-navigation";
import { ChevronRight, Folder as FolderIcon, Plus } from "lucide-react";
import type { LayerAvailability } from "@/features/map/query";
import type { CollectionNode } from "@/features/layers/collections-types";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { maxAppliedCollections, maxAppliedLayers } from "@taiwanhub/shared";
import { layerColor } from "@/components/map/layer-section";
import { folderLayers } from "@/lib/folder-tree";
import {
  layerTitle,
  orderLayers,
  ownerLabel,
  scheduleLabel,
} from "@/lib/layer-labels";
import { panelTitleId } from "./map-sidebar";

function folderName(folder: CollectionNode, locale: Locale) {
  return locale === "zh-TW" && folder.titleChinese
    ? folder.titleChinese
    : folder.title;
}

/**
 * One folder in the tree. A folder goes on the map as a unit; when it is
 * applied its descendants are already included, so their own checkboxes show
 * as included and disabled. Otherwise its layers can be ticked one by one, and
 * a folder holding a ticked layer starts open so that tick stays in view.
 */
function FolderItem({
  folder,
  included,
  appliedFolders,
  shown,
  slotsFull,
  t,
  locale,
  onToggleFolder,
  onToggle,
}: {
  folder: CollectionNode;
  included: boolean;
  appliedFolders: string[];
  /** Slugs of the layers ticked on their own. */
  shown: Set<string>;
  slotsFull: boolean;
  t: Copy;
  locale: Locale;
  onToggleFolder: (slug: string, applied: boolean) => void;
  onToggle: (slug: string, applied: boolean) => void;
}) {
  const filed = folderLayers(folder);
  const [open, setOpen] = useState(() =>
    filed.some((layer) => shown.has(layer.slug)),
  );
  const groupId = useId();
  const title = folderName(folder, locale);
  const own = appliedFolders.includes(folder.slug);
  const inherited = included && !own;
  const checked = own || included;
  const hasChildren = folder.children.length > 0;
  const layerCount = new Set(filed.map((layer) => layer.id)).size;
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
                shown={shown}
                slotsFull={slotsFull}
                t={t}
                locale={locale}
                onToggleFolder={onToggleFolder}
                onToggle={onToggle}
              />
            ) : (
              <li key={`l:${child.layer.id}`} className="folder-layer">
                <div className="layer-toggle">
                  <input
                    type="checkbox"
                    checked={checked || shown.has(child.layer.slug)}
                    aria-label={`${t.showOnMap}: ${layerTitle(child.layer, locale)}`}
                    title={checked ? t.folderIncludedInParent : undefined}
                    disabled={
                      checked || (!shown.has(child.layer.slug) && slotsFull)
                    }
                    onChange={(e) =>
                      onToggle(child.layer.slug, e.target.checked)
                    }
                  />
                  <span className="layer-title">
                    <span
                      className="layer-swatch"
                      style={{ background: layerColor(child.layer.slug) }}
                      aria-hidden="true"
                    />
                    <Link href={`/layers/${child.layer.slug}`}>
                      {layerTitle(child.layer, locale)}
                    </Link>
                  </span>
                </div>
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
 * the session so hiding is reversible without a trip to the library. It is
 * one tree: the member's folders come first and share the same map slots, and
 * a layer filed in a folder is listed there rather than among the loose ones.
 */
export function ActiveLayersPanel({
  layers,
  shownSlugs,
  hidden,
  library,
  folders,
  appliedFolders,
  onToggleFolder,
  t,
  locale,
  refreshing,
  onToggle,
}: {
  layers: LayerAvailability[];
  /** Ticked layers, ahead of the results that describe them. */
  shownSlugs: string[];
  hidden: LayerAvailability[];
  /** The member's own, group and followed layers, loadable from here. */
  library: LayerAvailability[];
  /** The member's top-level folders with their trees. */
  folders: CollectionNode[];
  /** Slugs of the folders on the map. */
  appliedFolders: string[];
  onToggleFolder: (slug: string, applied: boolean) => void;
  t: Copy;
  locale: Locale;
  refreshing: boolean;
  onToggle: (slug: string, applied: boolean) => void;
}) {
  const used = shownSlugs.length + appliedFolders.length;
  const slotsFull = used >= maxAppliedLayers;
  const shown = new Set(shownSlugs);
  const filed = new Set(
    folders.flatMap(folderLayers).map((layer) => layer.slug),
  );
  const listed = new Set([...layers, ...hidden].map((l) => l.slug));
  // Rows stay where they are when ticked; the checkbox carries the state.
  const rows = orderLayers(
    [
      ...layers,
      ...hidden,
      ...library.filter((l) => !listed.has(l.slug)),
    ].filter((l) => !filed.has(l.slug)),
    library,
  ).map((l) => ({ layer: l, applied: shown.has(l.slug) }));
  const showFolders = folders.length > 0;
  return (
    <section className="active-layers" aria-labelledby={panelTitleId}>
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
      {rows.length === 0 && !showFolders && (
        <p className="muted">{t.noLayersYet}</p>
      )}
      <ul className="layer-rows" aria-labelledby={panelTitleId}>
        {folders.map((folder) => (
          <FolderItem
            key={folder.id}
            folder={folder}
            included={false}
            appliedFolders={appliedFolders}
            shown={shown}
            slotsFull={slotsFull}
            t={t}
            locale={locale}
            onToggleFolder={onToggleFolder}
            onToggle={onToggle}
          />
        ))}
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
                  {layer.status === "ok" && (
                    <span
                      className="layer-swatch"
                      style={{ background: layerColor(layer.slug) }}
                      aria-hidden="true"
                    />
                  )}
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
          </li>
        ))}
      </ul>
      <div className="layer-panel-actions">
        <Link className="button small" href="/layers/new">
          <Plus size={16} aria-hidden="true" />
          {t.createFromGoogle}
        </Link>
        <Link className="button secondary small" href="/layers">
          {t.findLayers}
        </Link>
      </div>
    </section>
  );
}
