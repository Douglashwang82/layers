"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Folder as FolderIcon } from "lucide-react";
import { maxCollectionDepth } from "@taiwanhub/shared";
import { api } from "@/components/actions";
import { LayerLink } from "./workspace-navigation";
import { FolderLink } from "./folder-link";
import type {
  CollectionCandidate,
  CollectionChild,
  CollectionNode,
} from "@/features/layers/collections-types";
import { type Copy, type Locale, format } from "@/lib/dictionary";

type Notice = { tone: "error" | "success"; text: string } | null;

function pick(locale: Locale, en: string, zh: string) {
  return locale === "zh-TW" && zh ? zh : en;
}
function childTitle(child: CollectionChild, locale: Locale) {
  return child.kind === "folder"
    ? pick(locale, child.folder.title, child.folder.titleChinese)
    : pick(locale, child.layer.title, child.layer.titleChinese);
}
function childId(child: CollectionChild) {
  return child.kind === "folder" ? child.folder.id : child.layer.id;
}

/**
 * The folder screen of the layer workspace: rename, add and remove layers,
 * nest sub-folders, reorder, delete, and put the folder on the map. Every
 * change goes through the folder API; a stale revision reloads the folder.
 */
export function FolderPanel({
  slug,
  t,
  locale,
}: {
  slug: string | undefined;
  t: Copy;
  locale: Locale;
}) {
  const router = useRouter();
  const [folder, setFolder] = useState<CollectionNode | null>(null);
  const [candidates, setCandidates] = useState<CollectionCandidate[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">(
    "loading",
  );
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [subName, setSubName] = useState("");
  const [layerId, setLayerId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!slug) {
      setState("missing");
      return;
    }
    try {
      const node = (await api(
        `layer-collections/${encodeURIComponent(slug)}`,
        "GET",
      )) as CollectionNode;
      setFolder(node);
      setName(node.title);
      setState("ready");
      if (node.canEdit) {
        const list = (await api(
          `layer-collections/${node.id}/candidates`,
          "GET",
        ).catch(() => [])) as CollectionCandidate[];
        setCandidates(list);
        setLayerId("");
      } else setCandidates([]);
    } catch {
      setFolder(null);
      setState("missing");
    }
  }, [slug]);
  useEffect(() => {
    setState("loading");
    setConfirmDelete(false);
    void load();
  }, [load]);

  const changed = () => window.dispatchEvent(new Event("layer:changed"));
  /** Runs a mutation, refreshing the folder and the map's folder list after it. */
  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (done) setNotice({ tone: "success", text: done });
      await load();
      changed();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "VERSION_CONFLICT") {
        setNotice({ tone: "error", text: t.folderConflict });
        await load();
      } else if (code === "FOLDER_TOO_DEEP")
        setNotice({
          tone: "error",
          text: format(t.folderTooDeep, { max: maxCollectionDepth }),
        });
      else
        setNotice({
          tone: "error",
          text: (error as Error).message || t.folderError,
        });
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading")
    return (
      <div className="container">
        <p role="status">{t.folderLoading}</p>
      </div>
    );
  if (state === "missing" || !folder)
    return (
      <div className="container">
        <p role="alert">{t.folderNotFound}</p>
        <LayerLink className="button secondary" href="/layers?tab=mine">
          {t.folderBack}
        </LayerLink>
      </div>
    );

  const title = pick(locale, folder.title, folder.titleChinese);
  const tooDeep = folder.depth >= maxCollectionDepth;
  const edit = folder.canEdit;

  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    void run(() =>
      api(`layer-collections/${folder.id}`, "PATCH", {
        revision: folder.revision,
        title: name.trim(),
      }),
    );
  };
  const addLayer = (event: FormEvent) => {
    event.preventDefault();
    if (!layerId) return;
    void run(() =>
      api(`layer-collections/${folder.id}/layers`, "POST", { layerId }),
    );
  };
  const removeLayer = (id: string) =>
    run(() => api(`layer-collections/${folder.id}/layers/${id}`, "DELETE"));
  const createSub = (event: FormEvent) => {
    event.preventDefault();
    if (!subName.trim() || tooDeep) return;
    void run(async () => {
      await api("layer-collections", "POST", {
        title: subName.trim(),
        city: folder.citySlug,
        audience: folder.audience === "public" ? "private" : folder.audience,
        parentId: folder.id,
      });
      setSubName("");
    });
  };
  const move = (index: number, by: -1 | 1) => {
    const order = folder.children.map((c) => ({
      kind: c.kind,
      id: childId(c),
    }));
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void run(() =>
      api(`layer-collections/${folder.id}`, "PATCH", {
        revision: folder.revision,
        order,
      }),
    );
  };
  const remove = () =>
    run(async () => {
      await api(`layer-collections/${folder.id}`, "DELETE");
      router.push("/?layerPanel=library&layerTab=mine", { scroll: false });
    });

  return (
    <div className="container folder-panel">
      <LayerLink className="text-button" href="/layers?tab=mine">
        {t.folderBack}
      </LayerLink>
      <div className="page-header">
        <h1>
          <FolderIcon size={22} aria-hidden="true" /> {title}
        </h1>
        {!edit && <p className="muted">{t.folderViewOnly}</p>}
      </div>
      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={notice.tone === "error" ? "form-error" : "fine-print"}
        >
          {notice.text}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="button"
          onClick={() =>
            router.push(`/?collections=${encodeURIComponent(folder.slug)}`)
          }
        >
          {t.folderShowOnMapButton}
        </button>
      </div>

      {edit && (
        <form className="form-panel" onSubmit={rename}>
          <label>
            {t.folderNameLabel}
            <input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="button secondary" disabled={busy || !name.trim()}>
            {t.folderSaveName}
          </button>
        </form>
      )}

      <section aria-labelledby="folder-contents">
        <h2 id="folder-contents">{t.folderContents}</h2>
        {folder.children.length === 0 ? (
          <p className="muted">{t.folderEmpty}</p>
        ) : (
          <ul className="folder-contents">
            {folder.children.map((child, index) => {
              const label = childTitle(child, locale);
              return (
                <li key={`${child.kind}:${childId(child)}`}>
                  {child.kind === "folder" ? (
                    <FolderLink slug={child.folder.slug}>
                      <FolderIcon size={14} aria-hidden="true" /> {label}
                    </FolderLink>
                  ) : (
                    <LayerLink href={`/layers/${child.layer.slug}`}>
                      {label}
                    </LayerLink>
                  )}
                  {edit && (
                    <span className="layer-actions">
                      <button
                        type="button"
                        className="text-button"
                        aria-label={format(t.folderMoveUp, { title: label })}
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        aria-label={format(t.folderMoveDown, { title: label })}
                        disabled={busy || index === folder.children.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown size={16} aria-hidden="true" />
                      </button>
                      {child.kind === "layer" && (
                        <button
                          type="button"
                          className="text-button"
                          aria-label={format(t.folderRemoveLayer, {
                            title: label,
                          })}
                          disabled={busy}
                          onClick={() => void removeLayer(child.layer.id)}
                        >
                          {t.folderRemove}
                        </button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {folder.hiddenCount > 0 && (
          <p className="fine-print">
            {format(t.folderHiddenCount, { count: folder.hiddenCount })}
          </p>
        )}
      </section>

      {edit && (
        <>
          <form className="form-panel" onSubmit={addLayer}>
            <label>
              {t.folderPickLayer}
              <select
                value={layerId}
                onChange={(e) => setLayerId(e.target.value)}
                disabled={candidates.length === 0}
              >
                <option value="">
                  {candidates.length
                    ? t.folderChooseLayer
                    : t.folderNoCandidates}
                </option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pick(locale, c.title, c.titleChinese)}
                  </option>
                ))}
              </select>
            </label>
            <button className="button secondary" disabled={busy || !layerId}>
              {t.folderAddLayer}
            </button>
          </form>

          <form className="form-panel" onSubmit={createSub}>
            <label>
              {t.folderNewSub}
              <input
                value={subName}
                maxLength={120}
                disabled={tooDeep}
                aria-describedby={tooDeep ? "folder-too-deep" : undefined}
                onChange={(e) => setSubName(e.target.value)}
              />
            </label>
            <button
              className="button secondary"
              disabled={busy || tooDeep || !subName.trim()}
              aria-describedby={tooDeep ? "folder-too-deep" : undefined}
            >
              {t.folderNewSub}
            </button>
            {tooDeep && (
              <p id="folder-too-deep" className="fine-print">
                {format(t.folderTooDeep, { max: maxCollectionDepth })}
              </p>
            )}
          </form>
        </>
      )}

      {folder.canManage && (
        <section className="danger-zone">
          {confirmDelete ? (
            <div role="group" aria-label={t.folderDelete}>
              <p>{t.folderDeleteConfirm}</p>
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                {t.folderDeleteYes}
              </button>{" "}
              <button
                type="button"
                className="button secondary"
                onClick={() => setConfirmDelete(false)}
              >
                {t.folderCancel}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button secondary"
              onClick={() => setConfirmDelete(true)}
            >
              {t.folderDelete}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
