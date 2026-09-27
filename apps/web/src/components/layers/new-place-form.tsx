"use client";
import { useState, type FormEvent } from "react";
import { LocateFixed, MapPin } from "lucide-react";
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
 * Creates a member-owned place in the current layer. Location comes from the
 * member's own position (approximate) or from the server geocoding the address
 * (exact); without either, the place is saved list-only.
 */
export function NewPlaceForm({
  layerId,
  layerSlug,
  cityName,
  initialName,
  t,
  onCreated,
  onCancel,
}: {
  layerId: string;
  layerSlug: string;
  cityName: string;
  initialName: string;
  t: Copy;
  onCreated: (item: MapItem, message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [nameChinese, setNameChinese] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState<Pin | null>(null);
  const [locating, setLocating] = useState(false);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState<Feedback>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [touched, setTouched] = useState(false);
  const nameError = touched && !name.trim() ? t.placeName : undefined;
  const websiteError =
    website && !/^https:\/\/\S+$/.test(website.trim()) ? t.website : undefined;
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
    try {
      const result = (await api(`layers/${layerId}/places`, "POST", {
        name: name.trim(),
        nameChinese: nameChinese.trim(),
        address: address.trim(),
        website: website.trim(),
        note: note.trim(),
        ...(pin ? { pin } : {}),
      })) as { place: CustomPlace; geocode: Outcome };
      const extra = outcomeText(result.geocode);
      onCreated(
        customMapItem(result.place, layerSlug),
        result.geocode === "matched" || !extra
          ? t.placeAdded
          : `${t.placeAdded} ${extra}`,
      );
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="form-stack new-place-form"
      onSubmit={submit}
      noValidate
      aria-labelledby="new-place-heading"
    >
      <h3 id="new-place-heading">{t.newPlace}</h3>
      <p className="fine-print">{t.newPlaceHelp}</p>
      <Field id="new-place-name" label={t.placeName} error={nameError}>
        <input
          {...fieldProps("new-place-name", { error: nameError })}
          type="text"
          value={name}
          maxLength={120}
          required
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field id="new-place-name-zh" label={t.chineseName}>
        <input
          id="new-place-name-zh"
          type="text"
          value={nameChinese}
          maxLength={120}
          onChange={(e) => setNameChinese(e.target.value)}
        />
      </Field>
      <Field id="new-place-address" label={t.address}>
        <input
          id="new-place-address"
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
      </div>
      <div aria-live="polite">
        <StatusMessage feedback={locationFeedback} />
      </div>
      <Field
        id="new-place-website"
        label={`${t.website} (${t.optional})`}
        error={websiteError}
      >
        <input
          {...fieldProps("new-place-website", { error: websiteError })}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={website}
          maxLength={500}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </Field>
      <Field id="new-place-note" label={t.note}>
        <textarea
          id="new-place-note"
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
          disabled={saving}
          aria-busy={saving || undefined}
        >
          {saving ? t.saving : t.savePlace}
        </button>
        <button type="button" className="button secondary" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
