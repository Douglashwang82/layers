"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from "lucide-react";
import { api, StatusMessage } from "@/components/actions";
import { Field, fieldProps } from "@/components/ui/field";
import type { LayerRecord } from "@/features/layers/repository";
import type { MapItem } from "@/features/map/query";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { itemTitle, ItemMeta } from "@/components/map/map-results";
type Feedback = { tone: "success" | "error"; text: string } | null;
type Draft = {
  title: string;
  titleChinese: string;
  description: string;
  schedule: "evergreen" | "day" | "range";
  startsOn: string;
  endsOn: string;
  audience: "private" | "group";
  groupId: string;
};
function draftOf(layer?: LayerRecord, groupId?: string): Draft {
  return {
    title: layer?.title ?? "",
    titleChinese: layer?.titleChinese ?? "",
    description: layer?.description ?? "",
    schedule:
      layer?.schedule === "day" || layer?.schedule === "range"
        ? layer.schedule
        : "evergreen",
    startsOn: layer?.startsOn ?? "",
    endsOn: layer?.endsOn ?? "",
    audience: layer?.audience === "group" || groupId ? "group" : "private",
    groupId: layer?.ownerGroupId ?? groupId ?? "",
  };
}
/**
 * Create: title only is required; the empty layer is saved immediately as a
 * draft. Edit: version-checked metadata, contents with reversible removal and
 * single-action reordering, and an item search that adds references.
 */
export function LayerEditor({
  mode,
  layer,
  items: initialItems,
  city,
  groups,
  t,
  locale,
  addKey,
  next,
  groupId,
}: {
  mode: "create" | "edit";
  layer?: LayerRecord;
  items?: MapItem[];
  city: { slug: string; name: string; timezone: string };
  groups: { id: string; name: string }[];
  t: Copy;
  locale: Locale;
  addKey?: string;
  next?: string;
  groupId?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(
    draftOf(layer, groups.some((g) => g.id === groupId) ? groupId : undefined),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [revision, setRevision] = useState(layer?.revision ?? 1);
  const [items, setItems] = useState<MapItem[]>(initialItems ?? []);
  const [undo, setUndo] = useState<MapItem | null>(null);
  const [itemFeedback, setItemFeedback] = useState<Feedback>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MapItem[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!draft.title.trim()) errors.title = t.layerTitle;
  if (draft.schedule !== "evergreen" && !draft.startsOn)
    errors.startsOn = t.dateFrom;
  if (
    draft.schedule === "range" &&
    draft.endsOn &&
    draft.endsOn < draft.startsOn
  )
    errors.endsOn = t.dateTo;
  const body = () => ({
    title: draft.title.trim(),
    titleChinese: draft.titleChinese.trim(),
    description: draft.description.trim(),
    schedule: draft.schedule,
    startsOn: draft.schedule === "evergreen" ? undefined : draft.startsOn,
    endsOn:
      draft.schedule === "range" ? draft.endsOn || draft.startsOn : undefined,
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (Object.keys(errors).length) {
      setFeedback({ tone: "error", text: Object.values(errors).join(" · ") });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      if (mode === "create") {
        const created = (await api("layers", "POST", {
          ...body(),
          city: city.slug,
          audience: draft.audience,
          groupId: draft.audience === "group" ? draft.groupId : undefined,
        })) as { layer: LayerRecord };
        setDirty(false);
        if (addKey) {
          try {
            await api(`layers/${created.layer.id}/items`, "POST", {
              key: addKey,
            });
          } catch (err) {
            setFeedback({ tone: "error", text: (err as Error).message });
          }
        }
        router.push(
          addKey && next ? next : `/layers/${created.layer.slug}/edit`,
        );
        return;
      }
      const updated = (await api(`layers/${layer!.id}`, "PATCH", {
        ...body(),
        revision,
      })) as { layer: LayerRecord };
      setRevision(updated.layer.revision);
      setDirty(false);
      setFeedback({ tone: "success", text: t.saveChanges + " ✓" });
      router.refresh();
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }
  async function done() {
    if (!layer) return;
    setSaving(true);
    try {
      if (dirty) {
        const updated = (await api(`layers/${layer.id}`, "PATCH", {
          ...body(),
          revision,
          lifecycle: "active",
        })) as {
          layer: LayerRecord;
        };
        setRevision(updated.layer.revision);
      } else if (layer.lifecycle === "draft")
        await api(`layers/${layer.id}`, "PATCH", {
          revision,
          lifecycle: "active",
        });
      setDirty(false);
      router.push(`/layers/${layer.slug}`);
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
      setSaving(false);
    }
  }
  async function remove(item: MapItem) {
    if (!layer) return;
    setPendingKey(item.key);
    setItemFeedback(null);
    try {
      await api(
        `layers/${layer.id}/items?key=${encodeURIComponent(item.key)}`,
        "DELETE",
      );
      setItems((list) => list.filter((i) => i.key !== item.key));
      setUndo(item);
      setItemFeedback({ tone: "success", text: t.removed });
    } catch (err) {
      setItemFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setPendingKey(null);
    }
  }
  async function add(item: MapItem) {
    if (!layer) return;
    setPendingKey(item.key);
    setItemFeedback(null);
    try {
      await api(`layers/${layer.id}/items`, "POST", { key: item.key });
      setItems((list) =>
        list.some((i) => i.key === item.key)
          ? list
          : [...list, { ...item, layers: [layer.slug] }],
      );
      if (undo?.key === item.key) setUndo(null);
      setItemFeedback({
        tone: "success",
        text: `${t.addedToLayer}: ${itemTitle(item, locale)}`,
      });
    } catch (err) {
      setItemFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setPendingKey(null);
    }
  }
  async function move(index: number, direction: -1 | 1) {
    if (!layer) return;
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[target]] = [
      reordered[target],
      reordered[index],
    ];
    setItems(reordered);
    try {
      const ids = await itemIds(layer.id, reordered);
      const updated = (await api(`layers/${layer.id}`, "PATCH", {
        revision,
        order: ids,
      })) as { layer: LayerRecord };
      setRevision(updated.layer.revision);
    } catch (err) {
      setItemFeedback({ tone: "error", text: (err as Error).message });
    }
  }
  async function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const id = ++searchSeq.current;
    setSearching(true);
    try {
      const response = await fetch(
        `/api/v1/map?city=${city.slug}&layers=none&scope=city&q=${encodeURIComponent(q)}&date=upcoming`,
      );
      const json = await response.json();
      if (id !== searchSeq.current) return;
      if (json.error) throw new Error(json.error.message);
      setResults((json.data as { items: MapItem[] }).items.slice(0, 30));
    } catch (err) {
      setItemFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      if (id === searchSeq.current) setSearching(false);
    }
  }
  const contained = new Set(items.map((i) => i.key));
  return (
    <div className={mode === "edit" ? "layer-editor-layout" : ""}>
      <form className="form-panel form-stack" onSubmit={submit} noValidate>
        <h1>{mode === "create" ? t.createLayer : t.editLayer}</h1>
        {mode === "create" && <p>{t.layerHelp}</p>}
        <Field
          id="layer-title"
          label={t.layerTitle}
          error={errors.title && dirty ? t.layerTitle : undefined}
        >
          <input
            {...fieldProps("layer-title", {
              error: errors.title && dirty ? t.layerTitle : undefined,
            })}
            type="text"
            value={draft.title}
            maxLength={80}
            required
            onChange={(e) => update({ title: e.target.value })}
          />
        </Field>
        <Field id="layer-title-zh" label={t.chineseName}>
          <input
            id="layer-title-zh"
            type="text"
            value={draft.titleChinese}
            maxLength={80}
            onChange={(e) => update({ titleChinese: e.target.value })}
          />
        </Field>
        <Field id="layer-purpose" label={t.purpose}>
          <textarea
            id="layer-purpose"
            value={draft.description}
            maxLength={500}
            rows={3}
            onChange={(e) => update({ description: e.target.value })}
          />
        </Field>
        <fieldset className="form-group">
          <legend>{t.schedule}</legend>
          <div className="segmented" role="group" aria-label={t.schedule}>
            {(
              [
                ["evergreen", t.scheduleEvergreen],
                ["day", t.scheduleDay],
                ["range", t.scheduleRange],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={draft.schedule === value ? "on" : ""}
                aria-pressed={draft.schedule === value}
                onClick={() => update({ schedule: value })}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.schedule !== "evergreen" && (
            <div className="form-row">
              <Field
                id="layer-start"
                label={draft.schedule === "day" ? t.date : t.dateFrom}
                error={dirty ? errors.startsOn : undefined}
              >
                <input
                  {...fieldProps("layer-start", {
                    error: dirty ? errors.startsOn : undefined,
                  })}
                  type="date"
                  value={draft.startsOn}
                  required
                  onChange={(e) => update({ startsOn: e.target.value })}
                />
              </Field>
              {draft.schedule === "range" && (
                <Field
                  id="layer-end"
                  label={t.dateTo}
                  error={dirty ? errors.endsOn : undefined}
                >
                  <input
                    {...fieldProps("layer-end", {
                      error: dirty ? errors.endsOn : undefined,
                    })}
                    type="date"
                    value={draft.endsOn}
                    min={draft.startsOn || undefined}
                    onChange={(e) => update({ endsOn: e.target.value })}
                  />
                </Field>
              )}
            </div>
          )}
          <p className="field-help">
            {format(t.timezoneNote, { city: city.name, zone: city.timezone })}
          </p>
        </fieldset>
        {mode === "create" && (
          <div className="audience-box">
            <b>{t.reviewAudience}</b>
            {groups.length === 0 ? (
              <p>{t.audiencePrivate}</p>
            ) : (
              <>
                <label className="field-label">
                  <span>
                    <input
                      type="radio"
                      name="audience"
                      checked={draft.audience === "private"}
                      onChange={() => update({ audience: "private" })}
                    />{" "}
                    {t.audiencePrivate}
                  </span>
                </label>
                <label className="field-label">
                  <span>
                    <input
                      type="radio"
                      name="audience"
                      checked={draft.audience === "group"}
                      onChange={() =>
                        update({
                          audience: "group",
                          groupId: draft.groupId || groups[0].id,
                        })
                      }
                    />{" "}
                    {t.audienceGroup}
                  </span>
                </label>
                {draft.audience === "group" && (
                  <select
                    value={draft.groupId}
                    onChange={(e) => update({ groupId: e.target.value })}
                    aria-label={t.libraryGroups}
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
            <p className="fine-print">{t.publishNote}</p>
          </div>
        )}
        <div className="actions">
          <button
            type="submit"
            className="button"
            disabled={saving}
            aria-busy={saving || undefined}
          >
            {saving
              ? t.saving
              : mode === "create"
                ? t.createLayer
                : t.saveChanges}
          </button>
          {mode === "edit" && layer && (
            <>
              <button
                type="button"
                className="button secondary"
                disabled={saving}
                onClick={done}
              >
                {t.done}
              </button>
              <Link className="text-button" href={`/layers/${layer.slug}`}>
                {t.viewLayer}
              </Link>
            </>
          )}
        </div>
        {dirty && <p className="fine-print">{t.unsavedChanges}</p>}
        <StatusMessage feedback={feedback} />
      </form>
      {mode === "edit" && layer && (
        <section className="form-panel" aria-labelledby="contents-editor">
          <h2 id="contents-editor">{t.contents}</h2>
          <p className="muted">
            {format(t.itemsCount, { count: items.length })}
          </p>
          {layer.lifecycle === "draft" && items.length === 0 && (
            <p className="notice">{t.draftSaved}</p>
          )}
          <ul className="layer-contents">
            {items.map((item, index) => (
              <li key={item.key} className="result-row">
                <a href={item.href}>
                  <span className="row-thumb" aria-hidden="true" />
                  <span className="row-body">
                    <span className="row-kicker">{item.category}</span>
                    <span className="row-title">{itemTitle(item, locale)}</span>
                    <ItemMeta item={item} t={t} locale={locale} />
                  </span>
                  <span className="editor-item-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t.moveUp}
                      disabled={index === 0}
                      onClick={(e) => {
                        e.preventDefault();
                        move(index, -1);
                      }}
                    >
                      <ArrowUp size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t.moveDown}
                      disabled={index === items.length - 1}
                      onClick={(e) => {
                        e.preventDefault();
                        move(index, 1);
                      }}
                    >
                      <ArrowDown size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`${t.removeFromLayer}: ${itemTitle(item, locale)}`}
                      disabled={pendingKey === item.key}
                      aria-busy={pendingKey === item.key || undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        remove(item);
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {undo && (
            <p className="message success-message" role="status">
              {t.removed}{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => add(undo)}
              >
                {t.undo}
              </button>
            </p>
          )}
          <StatusMessage feedback={itemFeedback} />
          <h3 id="add-items">{t.addItems}</h3>
          <form
            className="editor-search"
            onSubmit={search}
            role="search"
            aria-labelledby="add-items"
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={format(t.searchCity, { city: city.name })}
              aria-label={t.search}
            />
            <button
              type="submit"
              className="button"
              disabled={searching}
              aria-busy={searching || undefined}
            >
              <Search size={16} aria-hidden="true" />
              {t.search}
            </button>
          </form>
          {results.length > 0 && (
            <ul className="layer-contents editor-results">
              {results.map((item) => (
                <li key={item.key} className="result-row">
                  <a href={item.href} onClick={(e) => e.preventDefault()}>
                    <span className="row-thumb" aria-hidden="true" />
                    <span className="row-body">
                      <span className="row-kicker">{item.category}</span>
                      <span className="row-title">
                        {itemTitle(item, locale)}
                      </span>
                      <ItemMeta item={item} t={t} locale={locale} />
                    </span>
                    <span className="editor-item-actions">
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={
                          contained.has(item.key) || pendingKey === item.key
                        }
                        aria-busy={pendingKey === item.key || undefined}
                        onClick={() => add(item)}
                      >
                        <Plus size={14} aria-hidden="true" />
                        {contained.has(item.key)
                          ? t.addedToLayer
                          : t.addToLayer}
                      </button>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
/** Layer item ids in the desired order, resolved from the authorized layer record. */
async function itemIds(layerId: string, ordered: MapItem[]) {
  const found = (await api(`layers/${layerId}/items?order=1`, "GET")) as {
    items: { id: string; key: string }[];
  };
  const byKey = new Map(found.items.map((i) => [i.key, i.id]));
  return ordered
    .map((i) => byKey.get(i.key))
    .filter((id): id is string => !!id);
}
