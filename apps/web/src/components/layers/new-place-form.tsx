"use client";
import { useState, type FormEvent } from "react";
import { LocateFixed, MapPin, Trash2 } from "lucide-react";
import { api, StatusMessage } from "@/components/actions";
import { Field, fieldProps } from "@/components/ui/field";
import type { CustomPlace } from "@/features/custom-places/repository";
import type { MapItem } from "@/features/map/query";
import { customMapItem } from "@/lib/custom-places";
import { type Copy, format } from "@/lib/dictionary";
type Feedback = { tone: "success" | "error"; text: string } | null;
type Outcome =
  "matched" | "no_match" | "outside_city" | "unavailable" | "skipped";
type Pin = { latitude: number; longitude: number };
/**
 * Creates a member-owned place in the current layer, or edits one (`editing`).
 * Location comes from the member's own position (approximate) or from the
 * server geocoding the address (exact); without either, the place is list-only.
 * Deleting removes the place from every layer of its owner.
 */
export function NewPlaceForm({
  layerId,
  layerSlug,
  cityName,
  initialName = "",
  editing,
  t,
  onSaved,
  onDeleted,
  onCancel,
}: {
  layerId: string;
  layerSlug: string;
  cityName: string;
  initialName?: string;
  editing?: CustomPlace;
  t: Copy;
  onSaved: (item: MapItem, message: string) => void;
  onDeleted?: (key: string, message: string) => void;
  onCancel: () => void;
}) {
  const id = editing ? "edit-place" : "new-place";
  const [name, setName] = useState(editing?.name ?? initialName);
  const [nameChinese, setNameChinese] = useState(editing?.nameChinese ?? "");
  const [address, setAddress] = useState(editing?.address ?? "");
  const [website, setWebsite] = useState(editing?.website ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [pin, setPin] = useState<Pin | null>(null);
  /** Edit only: the member asked to take the place off the map. */
  const [clearLocation, setClearLocation] = useState(false);
  const [locating, setLocating] = useState(false);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState<Feedback>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [touched, setTouched] = useState(false);
  const nameError = touched && !name.trim() ? t.placeName : undefined;
  const websiteError =
    website && !/^https:\/\/\S+$/.test(website.trim()) ? t.website : undefined;
  const currentLocation = !editing
    ? null
    : clearLocation
      ? t.locationNone
      : editing.locationStatus === "exact"
        ? t.locationExact
        : editing.locationStatus === "approximate"
          ? t.locationPinned
          : t.locationNone;
  const outcomeText = (outcome: Outcome, matched = "") =>
    outcome === "matched"
      ? format(t.locationMatched, { address: matched || address })
      : outcome === "no_match"
        ? t.locationNoMatch
        : outcome === "outside_city"
          ? format(t.locationOutsideCity, { city: cityName })
          : outcome === "unavailable"
            ? t.locationUnavailable
            : "";
  async function findOnMap() {
    if (!address.trim()) return;
    setLooking(true);
    setLocationFeedback(null);
    try {
      const result = (await api(`layers/${layerId}/geocode`, "POST", {
        address,
      })) as { outcome: Outcome; matchedAddress: string };
      setPin(null);
      setLocationFeedback({
        tone: result.outcome === "matched" ? "success" : "error",
        text: outcomeText(result.outcome, result.matchedAddress),
      });
    } catch (err) {
      setLocationFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setLooking(false);
    }
  }
  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setLocationFeedback({ tone: "error", text: t.currentLocationDenied });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPin({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setClearLocation(false);
        setLocationFeedback({ tone: "success", text: t.locationPinned });
        setLocating(false);
      },
      () => {
        setLocationFeedback({ tone: "error", text: t.currentLocationDenied });
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!name.trim() || websiteError) return;
    setSaving(true);
    setFeedback(null);
    const fields = {
      name: name.trim(),
      nameChinese: nameChinese.trim(),
      address: address.trim(),
      website: website.trim(),
      note: note.trim(),
    };
    try {
      const result = editing
        ? ((await api(`custom-places/${editing.id}`, "PATCH", {
            ...fields,
            ...(pin ? { pin } : clearLocation ? { pin: null } : {}),
          })) as { place: CustomPlace; geocode: Outcome })
        : ((await api(`layers/${layerId}/places`, "POST", {
            ...fields,
            ...(pin ? { pin } : {}),
          })) as { place: CustomPlace; geocode: Outcome });
      const done = editing ? t.placeUpdated : t.placeAdded;
      const extra = outcomeText(result.geocode);
      onSaved(
        customMapItem(result.place, layerSlug),
        result.geocode === "matched" || !extra ? done : `${done} ${extra}`,
      );
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!editing) return;
    setDeleting(true);
    setFeedback(null);
    try {
      await api(`custom-places/${editing.id}`, "DELETE");
      onDeleted?.(editing.key, t.placeDeleted);
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
      setDeleting(false);
    }
  }
  return (
    <form
      className="form-stack new-place-form"
      onSubmit={submit}
      noValidate
      aria-labelledby={`${id}-heading`}
    >
      <h3 id={`${id}-heading`}>{editing ? t.editPlaceHeading : t.newPlace}</h3>
      <p className="fine-print">{t.newPlaceHelp}</p>
      <Field id={`${id}-name`} label={t.placeName} error={nameError}>
        <input
          {...fieldProps(`${id}-name`, { error: nameError })}
          type="text"
          value={name}
          maxLength={120}
          required
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field id={`${id}-name-zh`} label={t.chineseName}>
        <input
          id={`${id}-name-zh`}
          type="text"
          value={nameChinese}
          maxLength={120}
          onChange={(e) => setNameChinese(e.target.value)}
        />
      </Field>
      <Field id={`${id}-address`} label={t.address}>
        <input
          id={`${id}-address`}
          type="text"
          value={address}
          maxLength={300}
          autoComplete="street-address"
          onChange={(e) => {
            setAddress(e.target.value);
            setLocationFeedback(null);
          }}
        />
      </Field>
      {currentLocation && !pin && (
        <p className="fine-print">{currentLocation}</p>
      )}
      <div className="actions">
        <button
          type="button"
          className="button secondary small"
          onClick={findOnMap}
          disabled={!address.trim() || looking}
          aria-busy={looking || undefined}
        >
          <MapPin size={14} aria-hidden="true" />
          {t.findOnMap}
        </button>
        <button
          type="button"
          className="button secondary small"
          onClick={useMyLocation}
          disabled={locating}
          aria-busy={locating || undefined}
        >
          <LocateFixed size={14} aria-hidden="true" />
          {t.useMyLocation}
        </button>
        {editing &&
          (pin ||
            (editing.locationStatus !== "unspecified" && !clearLocation)) && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                setPin(null);
                setClearLocation(true);
                setLocationFeedback(null);
              }}
            >
              {t.removeLocation}
            </button>
          )}
      </div>
      <div aria-live="polite">
        <StatusMessage feedback={locationFeedback} />
      </div>
      <Field
        id={`${id}-website`}
        label={`${t.website} (${t.optional})`}
        error={websiteError}
      >
        <input
          {...fieldProps(`${id}-website`, { error: websiteError })}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={website}
          maxLength={500}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </Field>
      <Field id={`${id}-note`} label={t.note}>
        <textarea
          id={`${id}-note`}
          value={note}
          maxLength={300}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <StatusMessage feedback={feedback} />
      <div className="actions">
        <button
          type="submit"
          className="button"
          disabled={saving || deleting}
          aria-busy={saving || undefined}
        >
          {saving ? t.saving : t.savePlace}
        </button>
        <button type="button" className="button secondary" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
      {editing && (
        <div className="place-delete">
          {confirmingDelete ? (
            <div role="alert" className="notice notice-warning">
              <p>{format(t.deletePlaceConfirm, { name: editing.name })}</p>
              <div className="actions">
                <button
                  type="button"
                  className="button small"
                  onClick={remove}
                  disabled={deleting}
                  aria-busy={deleting || undefined}
                >
                  {t.deletePlace}
                </button>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={14} aria-hidden="true" /> {t.deletePlace}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
