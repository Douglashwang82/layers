import Link from "next/link";
import { Photo as Image } from "@/components/photo";
import { ArrowUpRight, MapPin, Check, Users } from "lucide-react";
import type { Content } from "@/features/catalog/repository";
import { type Copy, type Locale, localized, dateLabel } from "@/lib/i18n";
import type { Kind } from "@taiwanhub/shared";
export function TaiwaneseScore({ item, t }: { item: Content; t: Copy }) {
  return (
    <div className="score">
      <span>
        <Check size={13} />
        {item.score === null ? t.noVotes : `${item.score}% ${t.score}`}
      </span>
      <small>
        {item.responses} {t.responses}
      </small>
    </div>
  );
}
export function ContentCard({
  item,
  kind,
  t,
  locale,
}: {
  item: Content;
  kind: Kind;
  t: Copy;
  locale: Locale;
}) {
  return (
    <article className={`card ${kind}-card`}>
      <Link className="card-link" href={`/${kind}/${item.slug}`}>
        <div className="card-image">
          <Image
            src={item.image}
            alt={localized(item, locale)}
            fill
            sizes="(max-width:640px) 90vw, (max-width:1000px) 45vw, 25vw"
          />
          {item.isDemo && <span className="demo-pill">{t.demoShort}</span>}
          <span className="card-arrow">
            <ArrowUpRight size={18} />
          </span>
          {kind === "events" && item.startTime && (
            <div className="date-badge">
              <b>
                {new Date(item.startTime).toLocaleDateString(locale, {
                  day: "numeric",
                  timeZone: "America/Chicago",
                })}
              </b>
              <span>
                {new Date(item.startTime).toLocaleDateString(locale, {
                  month: "short",
                  timeZone: "America/Chicago",
                })}
              </span>
            </div>
          )}
        </div>
        <div className="card-body">
          <div className="card-kicker">
            {item.category}
            {kind === "places" && item.priceLevel && (
              <span>{" $".repeat(item.priceLevel)}</span>
            )}
          </div>
          <h3>{localized(item, locale)}</h3>
          {item.neighborhood && (
            <p className="muted card-location">
              <MapPin size={13} />
              {item.neighborhood}
            </p>
          )}
          {kind === "places" && <TaiwaneseScore item={item} t={t} />}{" "}
          {kind === "events" && (
            <>
              <p className="muted">{item.organizerName}</p>
              <div className="card-meta">
                <span>{dateLabel(item.startTime!, locale)}</span>
                <span>
                  <Users size={13} />
                  {item.attending} {t.attending}
                </span>
              </div>
            </>
          )}
          {kind === "products" && (
            <p className="muted">
              {item.brand} · {item.nameChinese}
            </p>
          )}
          {kind === "organizations" && (
            <p className="muted">{t.communityLabel}</p>
          )}
        </div>
      </Link>
    </article>
  );
}
export function CardGrid({
  items,
  kind,
  t,
  locale,
}: {
  items: Content[];
  kind: Kind;
  t: Copy;
  locale: Locale;
}) {
  return items.length ? (
    <div className={`card-grid ${kind === "events" ? "three" : ""}`}>
      {items.map((item) => (
        <ContentCard key={item.id} {...{ item, kind, t, locale }} />
      ))}
    </div>
  ) : (
    <EmptyState t={t} />
  );
}
export function EmptyState({ t }: { t: Copy }) {
  return (
    <div className="empty">
      <span>◌</span>
      <h3>{t.empty}</h3>
      <p>{t.emptyBody}</p>
    </div>
  );
}
export function SectionHeading({
  title,
  subtitle,
  href,
  t,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  t: Copy;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {href && (
        <Link href={href}>
          {t.viewAll}
          <ArrowUpRight size={16} />
        </Link>
      )}
    </div>
  );
}
