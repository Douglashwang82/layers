"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  CalendarDays,
  Crosshair,
  ExternalLink,
  MapPin,
  Sparkles,
} from "lucide-react";
import type { DailyPickView } from "@/features/daily-pick/repository";
import { api, StatusMessage } from "@/components/actions";
import { Photo as Image } from "@/components/photo";
import { type Copy, type Locale, format, localized } from "@/lib/dictionary";
import { pickDateLabel, pickText } from "@/lib/daily-pick";
import { track } from "@/lib/track";
import { getPlacesProvider, type LatLng } from "@/lib/places/provider";
import { subjectApi } from "@/lib/places/api";
import { ProviderDetails } from "@/components/places/provider-slot";
/**
 * Today's Daily Pick: identity, the approved description, the recorded reasons
 * and only the practical facts the listing supports. Works without the map.
 * A catalog-linked pick renders from the canonical place's current facts; an
 * external (non-catalog) version 2 winner has no server-stored name, address
 * or hours to render — those come live from the Google UI Kit component,
 * with an honest unavailable state when the provider can't resolve it.
 */
export function DailyPickCard({
  view,
  cityName,
  citySlug,
  providerKey,
  t,
  locale,
  authenticated,
  onShow,
  onShowToday,
  mapHref,
  onChanged,
}: {
  view: DailyPickView;
  cityName: string;
  citySlug: string;
  /** The browser-visible Places UI Kit key, or null when discovery is disabled. */
  providerKey: string | null;
  t: Copy;
  locale: Locale;
  authenticated: boolean;
  /** Map workspace: highlight the pick on the map. */
  onShow?: (key: string) => void;
  /** Map workspace: clear filters/area that hide the pick, then select it. */
  onShowToday?: (key: string) => void;
  /** Outside the map: a link that opens the map with the pick selected. */
  mapHref?: string;
  /**
   * Reload authoritative state after a save changes, so every control for the
   * same place agrees. Defaults to refreshing the server-rendered page.
   */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const pick = view.pick;
  const [saved, setSaved] = useState(view.saved);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [providerLocation, setProviderLocation] = useState<LatLng | null>(null);
  const [providerUnavailable, setProviderUnavailable] = useState(false);
  const provider = useMemo(
    () => getPlacesProvider(providerKey ?? undefined, locale),
    [providerKey, locale],
  );
  // Render with key={pick id + saved} so a new day or refreshed state resets local state.
  const pickId = pick?.id ?? null;
  useEffect(() => {
    track("daily_pick_shown", { city: citySlug, ready: pickId !== null });
  }, [citySlug, pickId]);
  const history = (
    <p className="daily-pick-history-link">
      <Link
        href={`/daily-pick?city=${encodeURIComponent(citySlug)}`}
        onClick={() => track("daily_pick_history_opened", { city: citySlug })}
      >
        <CalendarDays size={14} aria-hidden="true" /> {t.dailyPickHistory}
      </Link>
    </p>
  );
  const header = (
    <header className="daily-pick-header">
      <h2 id={`daily-pick-${citySlug}`}>
        <Sparkles size={16} aria-hidden="true" /> {t.dailyPick}
      </h2>
      <p className="fine-print">
        {cityName} ·{" "}
        <time dateTime={view.date}>{pickDateLabel(view.date, locale)}</time>
      </p>
    </header>
  );
  if (!pick)
    return (
      <section
        className="daily-pick-card is-empty"
        aria-labelledby={`daily-pick-${citySlug}`}
      >
        {header}
        <p role="status">{t.dailyPickNotReady}</p>
        {view.previous && (
          <p className="muted">
            {format(t.dailyPickPrevious, {
              date: pickDateLabel(view.previous.date, locale),
            })}
            :{" "}
            <Link href={view.previous.href}>
              {view.previous.kind === "catalog"
                ? localized(view.previous, locale)
                : t.externalBusinesses}
            </Link>
          </p>
        )}
        {history}
      </section>
    );
  const { description, reason } = pickText(pick, locale);
  async function toggleSave() {
    if (!pick) return;
    if (!authenticated) {
      router.push(
        "/sign-in?next=" +
          encodeURIComponent(window.location.pathname + window.location.search),
      );
      return;
    }
    setPending(true);
    setFeedback(null);
    try {
      if (pick.kind === "catalog")
        await api(`places/${pick.placeId}/save`, saved ? "DELETE" : "POST");
      else
        await subjectApi(
          `place-subjects/${pick.subjectId}/save`,
          saved ? "DELETE" : "POST",
          saved ? undefined : {},
        );
      if (!saved) track("daily_pick_saved", { city: citySlug });
      setSaved(!saved);
      if (onChanged) onChanged();
      else router.refresh();
    } catch (e) {
      setFeedback({ tone: "error", text: (e as Error).message });
    } finally {
      setPending(false);
    }
  }
  const saveButton = (
    <button
      type="button"
      className={`button secondary ${saved ? "active" : ""}`}
      aria-pressed={saved}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={toggleSave}
    >
      <Bookmark size={16} aria-hidden="true" />
      {pending ? t.saving : saved ? t.unsave : t.save}
    </button>
  );
  const showOnMapControls = (
    <>
      {!view.inResults && onShowToday && (
        <div className="notice" role="status">
          <p>{t.dailyPickFiltered}</p>
          <button
            type="button"
            className="button secondary small"
            onClick={() => {
              track("daily_pick_show_on_map", { city: citySlug });
              onShowToday(pick.key);
            }}
          >
            <Crosshair size={14} aria-hidden="true" /> {t.dailyPickShowToday}
          </button>
        </div>
      )}
    </>
  );
  if (pick.kind === "external") {
    const directions = providerLocation
      ? `https://www.google.com/maps/search/?api=1&query=${providerLocation.lat},${providerLocation.lng}`
      : null;
    return (
      <section
        className="daily-pick-card"
        aria-labelledby={`daily-pick-${citySlug}`}
      >
        {header}
        <p className="eyebrow">
          {pick.foodType ?? ""}
          {pick.selectionKind === "editorial" && (
            <span className="layer-badge">{t.dailyPickEditorial}</span>
          )}
        </p>
        <h4>{t.dailyPickAbout}</h4>
        <p>{description}</p>
        <h4>{t.dailyPickWhy}</h4>
        <p>{reason}</p>
        <h4>{t.dailyPickDetails}</h4>
        {provider && pick.providerPlaceId && !providerUnavailable ? (
          <ProviderDetails
            provider={provider}
            placeId={pick.providerPlaceId}
            compact={false}
            onLoad={(place) => setProviderLocation(place.location)}
            onError={() => setProviderUnavailable(true)}
          />
        ) : (
          <p className="fine-print">{t.externalUnavailable}</p>
        )}
        <p className="fine-print">{t.dailyPickOpenNote}</p>
        {showOnMapControls}
        <div className="actions daily-pick-actions">
          <Link
            className="button"
            href={pick.href}
            onClick={() => track("daily_pick_place_opened", { city: citySlug })}
          >
            {t.dailyPickViewPlace}
          </Link>
          {saveButton}
          {directions && (
            <a
              className="button secondary"
              target="_blank"
              rel="noreferrer"
              href={directions}
              onClick={() => track("daily_pick_directions", { city: citySlug })}
            >
              <MapPin size={16} aria-hidden="true" />
              {t.directions} ↗
            </a>
          )}
          {view.inResults && onShow && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                track("daily_pick_show_on_map", { city: citySlug });
                onShow(pick.key);
              }}
            >
              <Crosshair size={16} aria-hidden="true" /> {t.dailyPickShowOnMap}
            </button>
          )}
          {mapHref && (
            <Link className="button secondary" href={mapHref}>
              <Crosshair size={16} aria-hidden="true" /> {t.dailyPickShowOnMap}
            </Link>
          )}
        </div>
        <StatusMessage feedback={feedback} />
        {history}
      </section>
    );
  }
  const name = localized(pick, locale);
  /** The official website when known, otherwise the listing's source page. */
  const link = pick.website ?? pick.sourceUrl;
  const directions =
    pick.latitude != null && pick.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${pick.latitude},${pick.longitude}`
      : null;
  return (
    <section
      className="daily-pick-card"
      aria-labelledby={`daily-pick-${citySlug}`}
    >
      {header}
      {pick.image && (
        <figure className="preview-image daily-pick-image">
          <Image src={pick.image} alt={name} fill sizes="400px" />
        </figure>
      )}
      <p className="eyebrow">
        {pick.category}
        {pick.neighborhood && ` · ${pick.neighborhood}`}
        {pick.selectionKind === "editorial" && (
          <span className="layer-badge">{t.dailyPickEditorial}</span>
        )}
      </p>
      <h3 className="daily-pick-name">{name}</h3>
      <h4>{t.dailyPickAbout}</h4>
      <p>{description}</p>
      <h4>{t.dailyPickWhy}</h4>
      <p>{reason}</p>
      <h4>{t.dailyPickDetails}</h4>
      <dl className="key-facts daily-pick-facts">
        <div>
          <dt>{t.dailyPickAddress}</dt>
          <dd>{pick.address}</dd>
        </div>
        {pick.hours && (
          <div>
            <dt>{t.hours}</dt>
            <dd>{pick.hours}</dd>
          </div>
        )}
        {pick.priceLevel && (
          <div>
            <dt>{t.dailyPickPrice}</dt>
            <dd>{"$".repeat(pick.priceLevel)}</dd>
          </div>
        )}
        {(link || pick.sourceLabel) && (
          <div>
            <dt>{pick.website ? t.dailyPickWebsite : t.source}</dt>
            <dd>
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer">
                  {pick.website
                    ? new URL(pick.website).hostname
                    : pick.sourceLabel}{" "}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : (
                pick.sourceLabel
              )}
            </dd>
          </div>
        )}
      </dl>
      <p className="fine-print">{t.dailyPickOpenNote}</p>
      {showOnMapControls}
      <div className="actions daily-pick-actions">
        <Link
          className="button"
          href={pick.href}
          onClick={() => track("daily_pick_place_opened", { city: citySlug })}
        >
          {t.dailyPickViewPlace}
        </Link>
        {saveButton}
        {directions && (
          <a
            className="button secondary"
            target="_blank"
            rel="noreferrer"
            href={directions}
            onClick={() => track("daily_pick_directions", { city: citySlug })}
          >
            <MapPin size={16} aria-hidden="true" />
            {t.directions} ↗
          </a>
        )}
        {view.inResults && onShow && (
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              track("daily_pick_show_on_map", { city: citySlug });
              onShow(pick.key);
            }}
          >
            <Crosshair size={16} aria-hidden="true" /> {t.dailyPickShowOnMap}
          </button>
        )}
        {mapHref && (
          <Link className="button secondary" href={mapHref}>
            <Crosshair size={16} aria-hidden="true" /> {t.dailyPickShowOnMap}
          </Link>
        )}
      </div>
      <StatusMessage feedback={feedback} />
      {history}
    </section>
  );
}
