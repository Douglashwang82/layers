import Link from "next/link";
import type { ReactNode } from "react";
import { Photo as Image } from "@/components/photo";
import { MapPin, Check, Users } from "lucide-react";
import type { Content } from "@/features/catalog/repository";
import { type Copy, type Locale, localized, dateLabel } from "@/lib/i18n";
import type { Kind } from "@taiwanhub/shared";
export type CardVariant = "feature" | "compact";
/** Raw community response ratio with its count always adjacent; never a smoothed rank. */
export function TaiwaneseScore({
  item,
  t,
  presentation = "compact",
}: {
  item: Content;
  t: Copy;
  presentation?: "compact" | "detail";
}) {
  return (
    <div className={`score score-${presentation}`}>
      {item.score === null ? (
        <span className="score-empty">{t.noVotes}</span>
      ) : (
        <span>
          <Check
            size={presentation === "detail" ? 20 : 14}
            aria-hidden="true"
          />
          <b>{item.score}%</b> {t.score}
        </span>
      )}
      <small>
        {item.responses} {t.responses}
      </small>
    </div>
  );
}
function eventDay(startTime: string, locale: Locale) {
  const date = new Date(startTime);
  return {
    day: date.toLocaleDateString(locale, {
      day: "numeric",
      timeZone: "America/Chicago",
    }),
    month: date.toLocaleDateString(locale, {
      month: "short",
      timeZone: "America/Chicago",
    }),
  };
}
export function ContentCard({
  item,
  kind,
  t,
  locale,
  variant = "feature",
}: {
  item: Content;
  kind: Kind;
  t: Copy;
  locale: Locale;
  variant?: CardVariant;
}) {
  const name = localized(item, locale);
  const meta =
    kind === "places" ? (
      <TaiwaneseScore item={item} t={t} />
    ) : kind === "events" ? (
      <>
        {item.organizerName && <p className="muted">{item.organizerName}</p>}
        <div className="card-meta">
          <span>{dateLabel(item.startTime!, locale)}</span>
          <span>
            <Users size={14} aria-hidden="true" />
            {item.attending} {t.attending}
          </span>
        </div>
      </>
    ) : kind === "products" ? (
      <p className="muted">
        {item.brand}
        {item.nameChinese && locale === "en" && ` · ${item.nameChinese}`}
      </p>
    ) : (
      <p className="muted">{t.communityLabel}</p>
    );
  const image = (
    <div className="card-image">
      <Image
        src={item.image}
        alt={name}
        fill
        sizes={
          variant === "compact"
            ? "104px"
            : "(max-width:599px) 100vw, (max-width:1099px) 50vw, 400px"
        }
      />
      {item.isDemo && <span className="demo-pill">{t.demoShort}</span>}
      {variant === "feature" && kind === "events" && item.startTime && (
        <div className="date-badge" aria-hidden="true">
          <b>{eventDay(item.startTime, locale).day}</b>
          <span>{eventDay(item.startTime, locale).month}</span>
        </div>
      )}
    </div>
  );
  return (
    <article className={`card card-${variant} ${kind}-card`}>
      <Link className="card-link" href={`/${kind}/${item.slug}`}>
        {image}
        <div className="card-body">
          <div className="card-kicker">
            <span>{item.category}</span>
            {kind === "places" && item.priceLevel && (
              <span aria-label={`${t.price} ${item.priceLevel}`}>
                {"$".repeat(item.priceLevel)}
              </span>
            )}
          </div>
          <h3>{name}</h3>
          {item.neighborhood && (
            <p className="muted card-location">
              <MapPin size={14} aria-hidden="true" />
              {item.neighborhood}
            </p>
          )}
          {meta}
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
  variant = "feature",
  mobileRows = false,
  empty,
}: {
  items: Content[];
  kind: Kind;
  t: Copy;
  locale: Locale;
  variant?: CardVariant;
  /** Reflow feature cards into thumbnail rows below 600px. */
  mobileRows?: boolean;
  empty?: ReactNode;
}) {
  if (!items.length) return <>{empty ?? <EmptyState t={t} />}</>;
  const classes = [
    variant === "compact" ? "card-list" : "card-grid",
    kind === "events" ? "three" : "",
    mobileRows ? "mobile-rows" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      {items.map((item) => (
        <ContentCard key={item.id} {...{ item, kind, t, locale, variant }} />
      ))}
    </div>
  );
}
export function EmptyState({
  t,
  title,
  body,
  action,
}: {
  t: Copy;
  title?: string;
  body?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="empty">
      <h3>{title ?? t.empty}</h3>
      <p>{body ?? t.emptyBody}</p>
      {action && (
        <Link className="button secondary" href={action.href}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
export function SectionHeading({
  title,
  subtitle,
  href,
  t,
  as: Heading = "h2",
}: {
  title: string;
  subtitle?: string;
  href?: string;
  t: Copy;
  as?: "h2" | "h3";
}) {
  return (
    <div className="section-heading">
      <div>
        <Heading>{title}</Heading>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {href && <Link href={href}>{t.viewAll} →</Link>}
    </div>
  );
}
