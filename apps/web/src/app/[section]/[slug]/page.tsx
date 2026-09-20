import type { Metadata } from "next";
import Link from "next/link";
import { Photo as Image } from "@/components/photo";
import { notFound } from "next/navigation";
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
import { TaiwaneseScore, CardGrid } from "@/components/cards";
import { DetailActions, ReportButton } from "@/components/actions";
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
  return (
    <div className="container">
      <div className="breadcrumbs">
        <Link href={"/" + kind}>← {t[kind]}</Link> / {localized(item, locale)}
      </div>
      <div className="detail-hero">
        <Image
          src={item.image}
          alt={localized(item, locale)}
          fill
          priority
          sizes="90vw"
        />
        {item.isDemo && <span className="demo-pill">{t.demoShort}</span>}
      </div>
      <div className="detail-layout">
        <div className="detail-main">
          <span className="eyebrow">
            {item.category} {item.neighborhood && ` / ${item.neighborhood}`}
          </span>
          <h1>{localized(item, locale)}</h1>
          {kind === "events" && item.eventStatus !== "scheduled" && (
            <div className="notice" role="status">
              {item.eventStatus === "cancelled"
                ? "This event has been cancelled. / 活動已取消。"
                : "This event has been postponed. / 活動已延期。"}
            </div>
          )}
          {kind === "places" && <TaiwaneseScore item={item} t={t} />}
          <DetailActions
            {...{ kind, t, state }}
            id={item.id}
            authenticated={!!actor}
            full={item.capacity != null && item.attending >= item.capacity}
            unavailable={kind === "events" && item.eventStatus !== "scheduled"}
          />
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
          {item.isDemo && <div className="notice">{t.demoDetail}</div>}
          {kind === "places" && (
            <>
              <h2>{t.recentRecommendations}</h2>
              {recommendations.map((r) => (
                <div className="note" key={r.id}>
                  <p>
                    {r.name} · {r.positive ? t.yes : t.no}
                  </p>
                  <small>{dateLabel(r.updated_at, locale)}</small>
                  <ReportButton kind="recommendations" id={r.id} t={t} />
                </div>
              ))}
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
                <p className="muted">{t.noVotes}</p>
              )}
              <h2>{t.map}</h2>
              <MapView items={[item]} t={t} />
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
                          {dateLabel(s.observed_at, locale)}{" "}
                          {s.is_demo && `· ${t.demoShort}`}
                        </small>
                      </p>
                      <ReportButton kind="sightings" id={s.id} t={t} />
                    </div>
                    <span>
                      {s.price != null ? `$${Number(s.price).toFixed(2)}` : ""}
                    </span>
                  </div>
                ))
              ) : (
                <p>{t.noSightings}</p>
              )}
            </>
          )}
          {orgEvents && (
            <>
              <h2>{t.upcoming}</h2>
              <CardGrid
                items={orgEvents.items}
                kind="events"
                {...{ t, locale }}
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
        <aside className="detail-sidebar">
          <h3>{t.details}</h3>
          <dl>
            {item.address && (
              <>
                <dt>{t.address}</dt>
                <dd>{item.address}</dd>
              </>
            )}
            {item.hours && (
              <>
                <dt>{t.hours}</dt>
                <dd>{item.hours}</dd>
              </>
            )}
            {item.startTime && (
              <>
                <dt>{t.start}</dt>
                <dd>
                  {dateLabel(item.startTime, locale)} ·{" "}
                  {new Date(item.startTime).toLocaleTimeString(locale, {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: "America/Chicago",
                  })}
                </dd>
                <dt>{t.end}</dt>
                <dd>
                  {dateLabel(item.endTime!, locale)} ·{" "}
                  {new Date(item.endTime!).toLocaleTimeString(locale, {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: "America/Chicago",
                  })}
                </dd>
                <dd className="fine-print">{t.timeNote}</dd>
                <dt>{t.venue}</dt>
                <dd>{item.venue}</dd>
                <dt>{t.rsvp}</dt>
                <dd>
                  {item.attending}
                  {item.capacity ? ` / ${item.capacity}` : ""} {t.attending}
                </dd>
              </>
            )}
            {organizer && (
              <>
                <dt>{t.organizer}</dt>
                <dd>
                  <Link href={"/organizations/" + organizer.slug}>
                    {organizer.name} ↗
                  </Link>
                </dd>
              </>
            )}
            {item.brand && (
              <>
                <dt>{t.brand}</dt>
                <dd>{item.brand}</dd>
              </>
            )}
            {item.phone && (
              <>
                <dt>{t.phone}</dt>
                <dd>
                  <a href={"tel:" + item.phone}>{item.phone}</a>
                </dd>
              </>
            )}
          </dl>
          {item.latitude && (
            <a
              className="button dark"
              target="_blank"
              rel="noreferrer"
              href={`https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`}
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
          {kind === "products" && flags.submissions && (
            <Link
              className="button dark"
              href={"/submit/product-sighting?product=" + item.id}
            >
              {t.found}
            </Link>
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
        </aside>
      </div>
    </div>
  );
}
