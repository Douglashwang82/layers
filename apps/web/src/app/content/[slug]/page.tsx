import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CalendarDays,
  ExternalLink,
  FileText,
  Globe,
  MapPin,
  MapPinOff,
} from "lucide-react";
import { AppError, itemKey, serializeMapQuery } from "@taiwanhub/shared";
import { Photo as Image } from "@/components/photo";
import { getContentPost } from "@/features/content/repository";
import { editableFor } from "@/features/map/detail";
import { getCopy, getLocale, format, dateLabel } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import { ReportButton } from "@/components/actions";
import { AddToLayer } from "@/components/layers/add-to-layer";
import { ContentSaveButton } from "@/components/content/content-actions";
type Props = { params: Promise<{ slug: string }> };
async function load(slug: string) {
  if (!flags.content) notFound();
  const actor = await currentActor();
  try {
    return { post: await getContentPost(slug, actor), actor };
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { post } = await load(slug);
  return {
    title: post.title,
    description: post.body.slice(0, 160),
    alternates: { canonical: `/content/${post.slug}` },
    robots: { index: post.status === "approved" && !post.isDemo, follow: true },
  };
}
/** Canonical content page: title/type, author, dates, location relevance, body, source. */
export default async function ContentPage({ params }: Props) {
  const { slug } = await params;
  const [{ post, actor }, t, locale] = await Promise.all([
    load(slug),
    getCopy(),
    getLocale(),
  ]);
  const title =
    locale === "zh-TW" && post.titleChinese ? post.titleChinese : post.title;
  const key = itemKey("content", post.id);
  const editableLayers =
    actor && flags.layerWrites ? await editableFor(actor, key) : [];
  const mapHref =
    "/" +
    serializeMapQuery(
      { city: post.citySlug, layers: [`discover-${post.citySlug}`], item: key },
      { includeCity: true },
    );
  const location =
    post.placeSlug && post.placeName ? (
      <Link href={`/places/${post.placeSlug}`}>{post.placeName}</Link>
    ) : post.eventSlug && post.eventName ? (
      <Link href={`/events/${post.eventSlug}`}>{post.eventName}</Link>
    ) : post.locationStatus === "online" ? (
      <>
        <Globe size={14} aria-hidden="true" /> {t.onlineLabel}
      </>
    ) : post.locationStatus === "citywide" ? (
      <>
        <Globe size={14} aria-hidden="true" /> {t.cityWide}
      </>
    ) : post.locationStatus === "approximate" ? (
      <>
        <MapPin size={14} aria-hidden="true" /> {t.approximateArea}
        {post.neighborhood && ` · ${post.neighborhood}`}
      </>
    ) : post.locationStatus === "exact" && post.latitude != null ? (
      <>
        <MapPin size={14} aria-hidden="true" /> {post.latitude.toFixed(4)},{" "}
        {post.longitude?.toFixed(4)}
      </>
    ) : (
      <>
        <MapPinOff size={14} aria-hidden="true" /> {t.noMapLocation}
      </>
    );
  return (
    <div className="container page-bottom">
      <nav className="breadcrumbs" aria-label={t.back}>
        <Link href="/">← {t.mapNav}</Link>
      </nav>
      <header className="detail-header">
        <p className="eyebrow">
          <FileText size={14} aria-hidden="true" />
          {t.contentLabel}
          {post.isDemo && ` · ${t.demoShort}`}
          {post.status !== "approved" && ` · ${t.statusPending}`}
        </p>
        <h1>{title}</h1>
        <p className="muted">
          {format(t.contentByline, {
            name: post.authorName,
            date: dateLabel(post.createdAt, locale),
          })}
          {post.updatedAt !== post.createdAt &&
            ` · ${format(t.updated, { date: dateLabel(post.updatedAt, locale) })}`}
        </p>
        <p className="muted preview-line">
          {t.relatedTo}: {location}
        </p>
        {(post.validFrom || post.validUntil) && (
          <p className="muted preview-line">
            <CalendarDays size={14} aria-hidden="true" />
            {post.validFrom && dateLabel(post.validFrom, locale)}
            {post.validFrom && post.validUntil && " – "}
            {post.validUntil && dateLabel(post.validUntil, locale)}
          </p>
        )}
        {post.status !== "approved" && (
          <div className="notice notice-warning">{t.contentPendingNote}</div>
        )}
        <div className="actions">
          {post.sourceUrl && (
            <a
              className="button"
              href={post.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} aria-hidden="true" />
              {t.openSource} ↗
            </a>
          )}
          {post.status === "approved" && (
            <ContentSaveButton
              id={post.id}
              saved={post.saved}
              authenticated={!!actor}
              t={t}
            />
          )}
          {post.status === "approved" && flags.layerWrites && (
            <AddToLayer
              itemKey={key}
              itemCity={post.citySlug}
              layers={editableLayers}
              authenticated={!!actor}
              t={t}
              locale={locale}
            />
          )}
          {post.status === "approved" && flags.mapHome && (
            <Link className="button secondary" href={mapHref}>
              <MapPin size={16} aria-hidden="true" />
              {t.mapEntry}
            </Link>
          )}
        </div>
      </header>
      {post.image && (
        <figure className="detail-image">
          <Image
            src={post.image}
            alt={title}
            fill
            priority
            sizes="(max-width:1099px) 100vw, 1200px"
          />
        </figure>
      )}
      <div className="detail-layout">
        <div className="detail-main">
          <p className="content-body">{post.body}</p>
          {post.latitude == null && (
            <p className="fine-print">{t.noLocationNote}</p>
          )}
          {post.sourceUrl && (
            <p className="fine-print">
              {t.source}:{" "}
              <a
                href={post.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {new URL(post.sourceUrl).hostname}
              </a>
            </p>
          )}
          <ReportButton kind="content" id={post.id} t={t} />
        </div>
      </div>
    </div>
  );
}
