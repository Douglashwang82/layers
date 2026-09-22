"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bookmark,
  Check,
  MapPin,
  Users,
  ExternalLink,
  Layers as LayersIcon,
  X,
} from "lucide-react";
import type { MapItem } from "@/features/map/query";
import type { ItemDetail } from "@/features/map/detail";
import { api, StatusMessage } from "@/components/actions";
import { AddToLayer } from "@/components/layers/add-to-layer";
import { Photo as Image } from "@/components/photo";
import {
  type Copy,
  type Locale,
  localized,
  dateLabel,
  format,
} from "@/lib/dictionary";
import { ItemMeta, itemTitle } from "./map-results";
const timeOf = (value: string, locale: string, timeZone: string) =>
  new Date(value).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
type Pending = "save" | "rsvp" | "yes" | "no";
/**
 * Shared detail surface for the map: kind-specific information order, one
 * primary action, per-action pending state and a link to the canonical page.
 */
export function ItemPreview({
  item,
  detail,
  loading,
  error,
  authenticated,
  t,
  locale,
  timeZone,
  citySlug,
  onClose,
  onRefresh,
  layerWrites,
  backLabel,
}: {
  item: MapItem;
  detail: ItemDetail | null;
  loading: boolean;
  error: string | null;
  authenticated: boolean;
  t: Copy;
  locale: Locale;
  timeZone: string;
  citySlug: string;
  onClose: () => void;
  onRefresh: () => void;
  layerWrites: boolean;
  backLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const name = itemTitle(item, locale);
  const directions =
    item.latitude != null && item.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`
      : null;
  const state = detail?.state ?? {
    saved: false,
    going: false,
    following: false,
    vote: null,
  };
  const eventState = detail?.eventState ?? "open";
  const content = detail?.type === "content" ? detail.post : null;
  const full = detail?.item ?? null;
  async function perform(
    label: Pending,
    path: string,
    method = "POST",
    body: unknown = {},
  ) {
    if (!authenticated) {
      router.push(
        "/sign-in?next=" +
          encodeURIComponent(window.location.pathname + window.location.search),
      );
      return;
    }
    setPending(label);
    setFeedback(null);
    try {
      await api(path, method, body);
      onRefresh();
    } catch (e) {
      setFeedback({ tone: "error", text: (e as Error).message });
    } finally {
      setPending(null);
    }
  }
  const kindPath =
    item.type === "place"
      ? "places"
      : item.type === "event"
        ? "events"
        : "content";
  const rsvpBlocked = eventState !== "open" && !state.going;
  return (
    <article className="item-preview" aria-labelledby="preview-title">
      <div className="preview-bar">
        <button type="button" className="text-button" onClick={onClose}>
          <ArrowLeft size={16} aria-hidden="true" /> {backLabel}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t.close}
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {item.image && (
        <figure className="preview-image">
          <Image src={item.image} alt={name} fill sizes="400px" />
          {item.isDemo && <span className="demo-pill">{t.demoShort}</span>}
        </figure>
      )}
      <p className="eyebrow">
        {item.category}
        {item.neighborhood && ` · ${item.neighborhood}`}
      </p>
      <h2 id="preview-title">{name}</h2>
      <ItemMeta {...{ item, t, locale }} />
      {item.type === "place" && item.address && (
        <p className="muted preview-line">
          <MapPin size={14} aria-hidden="true" /> {item.address}
        </p>
      )}
      {item.type === "event" && item.startTime && item.endTime && (
        <dl className="key-facts">
          <div>
            <dt>{t.start}</dt>
            <dd>
              {dateLabel(item.startTime, locale, timeZone)} ·{" "}
              {timeOf(item.startTime, locale, timeZone)}
            </dd>
          </div>
          {item.address && (
            <div>
              <dt>{t.venue}</dt>
              <dd>{item.address}</dd>
            </div>
          )}
          <div>
            <dt>
              <Users size={14} aria-hidden="true" /> {t.rsvp}
            </dt>
            <dd className="th-tabular">
              {full?.attending ?? item.attending}
              {item.capacity ? ` / ${item.capacity}` : ""} {t.attending}
            </dd>
          </div>
        </dl>
      )}
      {item.type === "event" &&
        eventState !== "open" &&
        eventState !== "full" && (
          <div className="notice notice-warning" role="status">
            {eventState === "cancelled"
              ? t.eventCancelled
              : eventState === "postponed"
                ? t.eventPostponed
                : t.eventEnded}
          </div>
        )}
      {item.type === "content" && (
        <div className="preview-content">
          <p>{content?.body ?? item.excerpt}</p>
          {(content?.placeName || item.address) && (
            <p className="muted preview-line">
              <MapPin size={14} aria-hidden="true" />{" "}
              {content?.placeSlug ? (
                <Link href={`/places/${content.placeSlug}`}>
                  {content.placeName}
                </Link>
              ) : (
                item.address
              )}
            </p>
          )}
        </div>
      )}
      {item.note && (
        <p className="curator-note">
          <b>{t.curatorNote}:</b> {item.note}
        </p>
      )}
      {item.layers.length > 0 && (
        <p className="muted preview-line">
          <LayersIcon size={14} aria-hidden="true" />{" "}
          {item.layers.length === 1
            ? t.inOneLayer
            : format(t.inLayers, { count: item.layers.length })}
        </p>
      )}
      <div className="actions preview-actions">
        {item.type === "place" && directions && (
          <a
            className="button"
            target="_blank"
            rel="noreferrer"
            href={directions}
          >
            <MapPin size={16} aria-hidden="true" />
            {t.directions} ↗
          </a>
        )}
        {item.type === "event" && (
          <button
            type="button"
            className={`button ${state.going ? "active" : ""}`}
            disabled={pending === "rsvp" || rsvpBlocked || loading}
            aria-busy={pending === "rsvp" || undefined}
            onClick={() =>
              perform(
                "rsvp",
                `events/${item.id}/rsvp`,
                state.going ? "DELETE" : "POST",
              )
            }
          >
            <Check size={16} aria-hidden="true" />
            {pending === "rsvp"
              ? t.updating
              : state.going
                ? t.cancelRsvp
                : eventState === "full"
                  ? t.full
                  : eventState !== "open"
                    ? t.rsvpUnavailable
                    : t.rsvp}
          </button>
        )}
        {item.type === "content" && content?.sourceUrl && (
          <a
            className="button"
            target="_blank"
            rel="noreferrer"
            href={content.sourceUrl}
          >
            <ExternalLink size={16} aria-hidden="true" />
            {t.openSource} ↗
          </a>
        )}
        {item.type === "content" && !content?.sourceUrl && (
          <Link className="button" href={item.href}>
            {t.readContent}
          </Link>
        )}
        {item.type !== "place" && directions && (
          <a
            className="button secondary"
            target="_blank"
            rel="noreferrer"
            href={directions}
          >
            {t.directions} ↗
          </a>
        )}
        <button
          type="button"
          className={`button secondary ${state.saved ? "active" : ""}`}
          disabled={pending === "save" || loading}
          aria-busy={pending === "save" || undefined}
          onClick={() =>
            perform(
              "save",
              `${kindPath}/${item.id}/save`,
              state.saved ? "DELETE" : "POST",
            )
          }
        >
          <Bookmark size={16} aria-hidden="true" />
          {pending === "save" ? t.saving : state.saved ? t.unsave : t.save}
        </button>
        {layerWrites && (
          <AddToLayer
            itemKey={item.key}
            itemCity={citySlug}
            layers={detail?.editableLayers ?? []}
            authenticated={authenticated}
            t={t}
            locale={locale}
            onChanged={onRefresh}
            compact
          />
        )}
      </div>
      {item.type === "place" && (
        <div className="preview-recommend">
          <span className="muted">{t.recommend}</span>
          <div className="actions">
            <button
              type="button"
              className={`button small ${state.vote === true ? "active" : ""}`}
              aria-pressed={state.vote === true}
              disabled={pending === "yes" || loading}
              aria-busy={pending === "yes" || undefined}
              onClick={() =>
                perform("yes", `places/${item.id}/recommendation`, "POST", {
                  positive: true,
                })
              }
            >
              {pending === "yes" ? t.submitting : t.yes}
            </button>
            <button
              type="button"
              className={`button secondary small ${state.vote === false ? "active" : ""}`}
              aria-pressed={state.vote === false}
              disabled={pending === "no" || loading}
              aria-busy={pending === "no" || undefined}
              onClick={() =>
                perform("no", `places/${item.id}/recommendation`, "POST", {
                  positive: false,
                })
              }
            >
              {pending === "no" ? t.submitting : t.no}
            </button>
          </div>
        </div>
      )}
      <StatusMessage feedback={feedback} />
      {error && (
        <p className="message error-message" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="fine-print" aria-live="polite">
          {t.loadingDetails}
        </p>
      )}
      {full && (
        <p className="preview-description">
          {locale === "zh-TW" && full.descriptionChinese
            ? full.descriptionChinese
            : full.description}
        </p>
      )}
      {full?.hours && (
        <p className="muted preview-line">
          {t.hours}: {full.hours}
        </p>
      )}
      <Link className="button secondary full-details" href={item.href}>
        {t.openFullDetails} →
      </Link>
      {item.isDemo && <p className="fine-print">{t.demoDetail}</p>}
      {full && (
        <p className="fine-print">
          {t.source}: {full.source}
          {content?.authorName &&
            ` · ${localized({ name: content.authorName, nameChinese: "" }, locale)}`}
        </p>
      )}
    </article>
  );
}
