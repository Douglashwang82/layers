import type { Metadata } from "next";
import Link from "next/link";
import { Photo as Image } from "@/components/photo";
import { notFound } from "next/navigation";
import { CalendarDays, Clock, MapPin, Users } from "lucide-react";
import { AppError, kinds, listInput, type Kind } from "@taiwanhub/shared";
import {
  getContent,
  getNotes,
  getRecommendations,
  getSightings,
  getState,
  listContent,
} from "@/features/catalog/repository";
import { getCopy, getLocale, localized, dateLabel } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { TaiwaneseScore, CardGrid, EmptyState } from "@/components/cards";
import {
  DetailActions,
  ReportButton,
  type EventState,
} from "@/components/actions";
import { MapView } from "@/components/map-view";
import { flags } from "@/lib/config";
import { trackEvent } from "@/lib/analytics";
type Props = { params: Promise<{ section: string; slug: string }> };
async function load(params: Props["params"]) {
  const { section, slug } = await params;
  const kind = section as Kind;
  if (
    !kinds.includes(kind) ||
    (kind === "products" && !flags.products) ||
    (kind === "organizations" && !flags.organizations)
  )
    notFound();
  try {
    return { kind, item: await getContent(kind, slug) };
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind, item } = await load(params);
  return {
    title: `${item.name} — ${item.category} in Houston`,
    description: item.description,
    alternates: { canonical: `/${kind}/${item.slug}` },
    openGraph: {
      title: item.name,
      description: item.description,
      images: [item.image],
    },
    ...(item.isDemo ? { robots: { index: false, follow: true } } : {}),
  };
}
const timeOf = (value: string, locale: string) =>
  new Date(value).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
export default async function DetailPage({ params }: Props) {
  const [{ kind, item }, t, locale, actor] = await Promise.all([
    load(params),
    getCopy(),
    getLocale(),
    currentActor(),
  ]);
  const state = await getState(kind, item.id, actor?.id);
  const recommendations =
    kind === "places" ? await getRecommendations(item.id) : [];
  const notes = kind === "places" ? await getNotes(item.id) : [];
  const sightings = kind === "products" ? await getSightings(item.id) : [];
  const organizer =
    kind === "events" && item.organizerId
      ? await getContent("organizations", item.organizerId).catch(() => null)
      : null;
  const orgEvents =
    kind === "organizations"
      ? await listContent("events", listInput.parse({ organization: item.id }))
      : null;
  if (["places", "events", "products"].includes(kind))
    await trackEvent(
      `${kind.slice(0, -1)}_viewed`,
      { entityId: item.id },
      actor?.id,
    );
  const name = localized(item, locale);
  const directions =
    item.latitude != null && item.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`
      : null;
  // The server stays authoritative; this only drives labels and the disabled state.
  const eventState: EventState =
    kind !== "events"
      ? "open"
      : item.eventStatus === "cancelled"
        ? "cancelled"
        : item.eventStatus === "postponed"
          ? "postponed"
          : item.endTime && new Date(item.endTime) < new Date()
            ? "ended"
            : item.capacity != null && item.attending >= item.capacity
              ? "full"
              : "open";
  const primary =
    kind === "places" && directions ? (
      <a className="button" target="_blank" rel="noreferrer" href={directions}>
        <MapPin size={16} aria-hidden="true" />
        {t.directions} ↗
      </a>
    ) : kind === "products" && flags.submissions ? (
      <Link
        className="button"
        href={"/submit/product-sighting?product=" + item.id}
      >
        {t.found}
      </Link>
    ) : undefined;
  return (
    <div className="container">
      <nav className="breadcrumbs" aria-label={t.back}>
        <Link href={"/" + kind}>← {t[kind]}</Link>
      </nav>
      <header className="detail-header">
        <p className="eyebrow">
          {item.category}
          {item.neighborhood && ` · ${item.neighborhood}`}
          {item.isDemo && ` · ${t.demoShort}`}
        </p>
        <h1>{name}</h1>
        {kind === "places" && (
          <>
            <TaiwaneseScore item={item} t={t} presentation="detail" />
            {(item.address || item.hours) && (
              <dl className="key-facts">
                {item.address && (
                  <div>
                    <dt>
                      <MapPin size={16} aria-hidden="true" />
                      {t.address}
                    </dt>
                    <dd>{item.address}</dd>
                  </div>
                )}
                {item.hours && (
                  <div>
                    <dt>
                      <Clock size={16} aria-hidden="true" />
                      {t.hours}
                    </dt>
                    <dd>{item.hours}</dd>
                  </div>
                )}
              </dl>
            )}
          </>
        )}
        {kind === "events" && item.startTime && (
          <dl className="key-facts">
            <div>
              <dt>
                <CalendarDays size={16} aria-hidden="true" />
                {t.start}
              </dt>
              <dd>
                {dateLabel(item.startTime, locale)} ·{" "}
                {timeOf(item.startTime, locale)}
              </dd>
            </div>
            {item.venue && (
              <div>
                <dt>
                  <MapPin size={16} aria-hidden="true" />
                  {t.venue}
                </dt>
                <dd>{item.venue}</dd>
              </div>
            )}
            <div>
              <dt>
                <Users size={16} aria-hidden="true" />
                {t.rsvp}
              </dt>
              <dd className="th-tabular">
                {item.attending}
                {item.capacity ? ` / ${item.capacity}` : ""} {t.attending}
              </dd>
            </div>
          </dl>
        )}
        {kind === "products" && (
          <p className="muted">
            {item.brand}
            {sightings[0] &&
              ` · ${t.sightings}: ${sightings[0].place_name}, ${dateLabel(sightings[0].observed_at, locale)}`}
          </p>
        )}
        {kind === "events" &&
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
        <DetailActions
          {...{ kind, t, state, eventState, primary }}
          id={item.id}
          authenticated={!!actor}
        />
      </header>
      <figure className="detail-image">
        <Image
          src={item.image}
          alt={name}
          fill
          priority
          sizes="(max-width:1099px) 100vw, 1200px"
        />
        {item.isDemo && <span className="demo-pill">{t.demoShort}</span>}
      </figure>
      <div className="detail-layout">
        <div className="detail-main">
          <h2>
            {kind === "organizations"
              ? t.orgProfile
              : kind === "products"
                ? t.productAbout
                : t.about}
          </h2>
          <p>
            {locale === "zh-TW" && item.descriptionChinese
              ? item.descriptionChinese
              : item.description}
          </p>
          {item.isDemo && (
            <div className="notice notice-warning">{t.demoDetail}</div>
          )}
          {kind === "places" && (
            <>
              <h2>{t.recentRecommendations}</h2>
              {recommendations.length ? (
                recommendations.map((r) => (
                  <div className="note" key={r.id}>
                    <p>
                      {r.name} · {r.positive ? t.yes : t.no}
                    </p>
                    <small>{dateLabel(r.updated_at, locale)}</small>
                    <ReportButton kind="recommendations" id={r.id} t={t} />
                  </div>
                ))
              ) : (
                <p className="muted">{t.noVotes}</p>
              )}
              <h2>{t.communityNotes}</h2>
              {notes.length ? (
                notes.map((n) => (
                  <div className="note" key={n.id}>
                    <p>{n.body}</p>
                    <small>
                      {n.name} · {dateLabel(n.created_at, locale)}
                    </small>
                    <ReportButton kind="notes" id={n.id} t={t} />
                  </div>
                ))
              ) : (
                <p className="muted">{t.notesPending}</p>
              )}
              <h2 id="map">{t.map}</h2>
              <MapView items={[item]} {...{ t, locale }} />
            </>
          )}
          {kind === "products" && (
            <>
              <h2>{t.sightings}</h2>
              <p className="fine-print">{t.inventory}</p>
              {sightings.length ? (
                sightings.map((s) => (
                  <div key={s.id} className="sighting-row">
                    <div>
                      <Link href={"/places/" + s.place_slug}>
                        {s.place_name} ↗
                      </Link>
                      <p>
                        <small>
                          {dateLabel(s.observed_at, locale)}
                          {s.is_demo && ` · ${t.demoShort}`}
                        </small>
                      </p>
                      <ReportButton kind="sightings" id={s.id} t={t} />
                    </div>
                    <span className="th-tabular">
                      {s.price != null ? `$${Number(s.price).toFixed(2)}` : ""}
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted">{t.noSightings}</p>
              )}
            </>
          )}
          {orgEvents && (
            <>
              <h2>{t.upcomingEvents}</h2>
              <CardGrid
                items={orgEvents.items}
                kind="events"
                {...{ t, locale }}
                empty={<EmptyState t={t} body={t.noEventsBody} />}
              />
            </>
          )}
          <div className="fine-print">
            {t.source}: {item.source} · {t.verified}:{" "}
            {item.verificationStatus === "UNVERIFIED"
              ? t.unverified
              : item.verificationStatus}
            {item.sourceLinks?.map((source) => (
              <span key={source.url}>
                {" "}
                ·{" "}
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.label}
                </a>
              </span>
            ))}
          </div>
          <ReportButton kind={kind} id={item.id} t={t} />
        </div>
        <aside className="detail-rail" aria-labelledby="details-heading">
          <h3 id="details-heading">{t.details}</h3>
          <dl>
            {item.address && (
              <div>
                <dt>{t.address}</dt>
                <dd>{item.address}</dd>
              </div>
            )}
            {item.hours && (
              <div>
                <dt>{t.hours}</dt>
                <dd>{item.hours}</dd>
              </div>
            )}
            {item.startTime && item.endTime && (
              <>
                <div>
                  <dt>{t.start}</dt>
                  <dd>
                    {dateLabel(item.startTime, locale)} ·{" "}
                    {timeOf(item.startTime, locale)}
                  </dd>
                </div>
                <div>
                  <dt>{t.end}</dt>
                  <dd>
                    {dateLabel(item.endTime, locale)} ·{" "}
                    {timeOf(item.endTime, locale)}
                  </dd>
                  <dd className="fine-print">{t.timeNote}</dd>
                </div>
              </>
            )}
            {organizer && (
              <div>
                <dt>{t.organizer}</dt>
                <dd>
                  <Link href={"/organizations/" + organizer.slug}>
                    {localized(organizer, locale)} ↗
                  </Link>
                </dd>
              </div>
            )}
            {item.brand && (
              <div>
                <dt>{t.brand}</dt>
                <dd>{item.brand}</dd>
              </div>
            )}
            {item.phone && (
              <div>
                <dt>{t.phone}</dt>
                <dd>
                  <a href={"tel:" + item.phone}>{item.phone}</a>
                </dd>
              </div>
            )}
          </dl>
          <div className="rail-actions">
            {kind !== "places" && directions && (
              <a
                className="button secondary"
                target="_blank"
                rel="noreferrer"
                href={directions}
              >
                {t.directions} ↗
              </a>
            )}
            {item.website && (
              <a
                className="button secondary"
                href={item.website}
                target="_blank"
                rel="noreferrer"
              >
                {t.website} ↗
              </a>
            )}
            {item.instagram && (
              <a
                className="button secondary"
                href={item.instagram}
                target="_blank"
                rel="noreferrer"
              >
                Instagram ↗
              </a>
            )}
            {item.facebook && (
              <a
                className="button secondary"
                href={item.facebook}
                target="_blank"
                rel="noreferrer"
              >
                Facebook ↗
              </a>
            )}
            {item.onlineUrl && (
              <a
                className="button secondary"
                href={item.onlineUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t.online} ↗
              </a>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
