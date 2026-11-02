"use client";
import { useEffect, useState, type FormEvent } from "react";
import { LayerLink as Link } from "./workspace-navigation";
import {
  useLayerRouter as useRouter,
  useLayerDraft,
} from "./workspace-navigation";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { api, StatusMessage } from "@/components/actions";
import { Field, fieldProps } from "@/components/ui/field";
import type { LayerRecord } from "@/features/layers/repository";
import type { MapItem } from "@/features/map/query";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { itemTitle, ItemMeta } from "@/components/map/map-results";
import type { CustomPlace } from "@/features/custom-places/repository";
import { NewPlaceForm } from "./new-place-form";
import type { LayerEvent } from "@taiwanhub/shared";
import { GoogleLinksForm } from "./google-links-form";
import { LayerGooglePlaces } from "./layer-google-places";
import { LayerItemEvents } from "./layer-item-events";
import { LayerItemReviewsByKey } from "./layer-item-reviews";
import { MapImportLinks } from "./map-import-links";
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
 * single-action reordering, and places added from Google Maps links.
 */
export function LayerEditor({
  mode,
  section,
  layer,
  items: initialItems,
  city,
  groups,
  t,
  locale,
  addKey,
  canSuggestPlace = false,
  next,
  groupId,
  canCreatePlaces = false,
  mapToken,
  cityCenter = { latitude: 29.7604, longitude: -95.3698 },
  providerKey = null,
}: {
  mode: "create" | "edit";
  section?: "settings" | "contents";
  layer?: LayerRecord;
  items?: MapItem[];
  city: { slug: string; name: string; timezone: string };
  groups: { id: string; name: string }[];
  t: Copy;
  locale: Locale;
  addKey?: string;
  /** Place submissions are enabled: the place form can offer a suggestion instead. */
  canSuggestPlace?: boolean;
  next?: string;
  groupId?: string;
  /** Custom places are enabled: editors create places here without review. */
  canCreatePlaces?: boolean;
  /** Public Mapbox token for the drop-a-pin map in the place form. */
  mapToken?: string;
  /** The layer city's centre, where the pin map starts. */
  cityCenter?: { latitude: number; longitude: number };
  /** Places UI Kit key for Google place previews. */
  providerKey?: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(
    draftOf(layer, groups.some((g) => g.id === groupId) ? groupId : undefined),
  );
  const [dirty, setDirty] = useState(false);
  useLayerDraft(dirty, t.discardLayerChanges);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [revision, setRevision] = useState(layer?.revision ?? 1);
  const [items, setItems] = useState<MapItem[]>(initialItems ?? []);
  const [undo, setUndo] = useState<MapItem | null>(null);
  const [itemFeedback, setItemFeedback] = useState<Feedback>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  /** Prefilled name while the new-place form is open; null when closed. */
  const [newPlaceName, setNewPlaceName] = useState<string | null>(null);
  /** The custom place open in the edit form, loaded fresh from the server. */
  const [editingPlace, setEditingPlace] = useState<CustomPlace | null>(null);
  async function editPlace(item: MapItem) {
    setPendingKey(item.key);
    setItemFeedback(null);
    try {
      const { place } = (await api(`custom-places/${item.id}`, "GET")) as {
        place: CustomPlace;
      };
      setNewPlaceName(null);
      setEditingPlace(place);
    } catch (err) {
      setItemFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setPendingKey(null);
    }
  }
  /** Attached events for every place in the layer. */
  const [events, setEvents] = useState<LayerEvent[]>([]);
  /** Bumped after Google places are added, so their list reloads. */
  const [googleReload, setGoogleReload] = useState(0);
  /** Google places listed below; the contents count includes them. */
  const [googleCount, setGoogleCount] = useState(0);
  const itemCount = items.length + googleCount;
  const layerId = layer?.id;
  useEffect(() => {
    if (!layerId) return;
    let cancelled = false;
    (
      api(`layers/${layerId}/events`, "GET") as Promise<{
        events: LayerEvent[];
      }>
    )
      .then((data) => {
        if (!cancelled) setEvents(data.events);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [layerId]);
  const setKeyEvents = (key: string, next: LayerEvent[]) =>
    setEvents((all) => [...all.filter((e) => e.key !== key), ...next]);
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
          addKey && next
            ? next
            : `/layers/${created.layer.slug}/edit#add-items`,
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
  return (
    <div className={mode === "edit" ? "layer-editor-layout" : ""}>
      {canCreatePlaces && layer?.audience !== "public" && (
        <MapImportLinks locale={locale} layerId={layer?.id} />
      )}
      <form
        hidden={section === "contents"}
        className="form-panel form-stack"
        onSubmit={submit}
        noValidate
      >
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
      {mode === "edit" && layer && section !== "settings" && (
        <section className="form-panel" aria-labelledby="contents-editor">
          <h2 id="contents-editor">{t.contents}</h2>
          {section === "contents" && (
            <button
              type="button"
              className="button secondary small"
              disabled={saving}
              onClick={done}
            >
              {t.done}
            </button>
          )}
          <p className="muted">{format(t.itemsCount, { count: itemCount })}</p>
          {layer.lifecycle === "draft" && itemCount === 0 && (
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
                    {item.customScope && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={format(t.editPlace, {
                          name: itemTitle(item, locale),
                        })}
                        disabled={pendingKey === item.key}
                        onClick={(e) => {
                          e.preventDefault();
                          editPlace(item);
                        }}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </button>
                    )}
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
                {item.type === "place" && (
                  <LayerItemEvents
                    layerId={layer.id}
                    itemKey={item.key}
                    itemName={itemTitle(item, locale)}
                    events={events.filter((e) => e.key === item.key)}
                    city={city}
                    t={t}
                    locale={locale}
                    onChange={(next) => setKeyEvents(item.key, next)}
                  />
                )}
                <LayerItemReviewsByKey
                  layerId={layer.id}
                  itemKey={item.key}
                  itemName={itemTitle(item, locale)}
                  t={t}
                  locale={locale}
                />
              </li>
            ))}
          </ul>
          <LayerGooglePlaces
            layer={layer}
            city={city}
            providerKey={providerKey}
            events={events}
            onEvents={setKeyEvents}
            reload={googleReload}
            onCount={setGoogleCount}
            t={t}
            locale={locale}
          />
          {editingPlace && (
            <NewPlaceForm
              key={editingPlace.id}
              layerId={layer.id}
              layerSlug={layer.slug}
              cityName={city.name}
              mapToken={mapToken}
              cityCenter={cityCenter}
              editing={editingPlace}
              canSuggest={canSuggestPlace}
              t={t}
              onCancel={() => setEditingPlace(null)}
              onSaved={(item, message) => {
                setItems((list) =>
                  list.map((i) =>
                    i.key === item.key
                      ? { ...item, layers: i.layers, note: i.note }
                      : i,
                  ),
                );
                setEditingPlace(null);
                setItemFeedback({ tone: "success", text: message });
              }}
              onDeleted={(key, message) => {
                setItems((list) => list.filter((i) => i.key !== key));
                if (undo?.key === key) setUndo(null);
                setEditingPlace(null);
                setItemFeedback({ tone: "success", text: message });
              }}
            />
          )}
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
          <h3 id="add-items">{t.addFromGoogle}</h3>
          <GoogleLinksForm
            mode="add"
            layerId={layer.id}
            city={city}
            providerKey={providerKey}
            t={t}
            locale={locale}
            onAdded={() => setGoogleReload((n) => n + 1)}
          />
          {canCreatePlaces && newPlaceName === null && (
            <div className="actions">
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  setEditingPlace(null);
                  setNewPlaceName("");
                }}
              >
                <Plus size={14} aria-hidden="true" />
                {t.newPlace}
              </button>
            </div>
          )}
          {canCreatePlaces && newPlaceName !== null && layer && (
            <NewPlaceForm
              layerId={layer.id}
              layerSlug={layer.slug}
              cityName={city.name}
              mapToken={mapToken}
              cityCenter={cityCenter}
              initialName={newPlaceName}
              t={t}
              onCancel={() => setNewPlaceName(null)}
              onSaved={(item, message) => {
                setItems((list) => [
                  ...list,
                  { ...item, layers: [layer.slug] },
                ]);
                setNewPlaceName(null);
                setItemFeedback({ tone: "success", text: message });
              }}
            />
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
