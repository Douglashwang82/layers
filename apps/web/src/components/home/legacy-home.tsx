import Link from "next/link";
import { Photo as Image } from "@/components/photo";
import {
  Search,
  Utensils,
  CalendarDays,
  Coffee,
  ShoppingBag,
  Users,
  MapPin,
} from "lucide-react";
import { getHomeFeed } from "@/features/catalog/repository";
import { getCopy, getLocale, dateLabel } from "@/lib/i18n";
import { getActiveCity } from "@/lib/city";
import { CardGrid, EmptyState, SectionHeading } from "@/components/cards";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
/** The previous content-first entry screen, kept for FEATURE_MAP_HOME=false rollback. */
export async function LegacyHome() {
  const [t, locale, actor, { city }] = await Promise.all([
    getCopy(),
    getLocale(),
    currentActor(),
    getActiveCity(),
  ]);
  const feed = await getHomeFeed(city.slug, actor?.id);
  type Shortcut = [icon: typeof Coffee, label: string, href: string];
  const shortcuts: Shortcut[] = [
    [Coffee, "Bubble Tea", "/places?category=Bubble+Tea"],
  ];
  if (flags.products) shortcuts.push([ShoppingBag, t.products, "/products"]);
  if (flags.organizations)
    shortcuts.push([Users, t.community, "/organizations"]);
  return (
    <div className="container">
      <section className="home-header">
        <p className="eyebrow">
          <MapPin size={14} aria-hidden="true" />
          {city.name}
        </p>
        <h1>{t.headline}</h1>
        <p className="home-lead">{t.heroBody}</p>
        <form action="/search" className="hero-search" role="search">
          <Search size={20} aria-hidden="true" />
          <input
            type="text"
            enterKeyHint="search"
            aria-label={t.searchLabel}
            name="q"
            placeholder={t.searchPlaceholder}
            autoComplete="off"
          />
          <button type="submit" aria-label={t.search}>
            <Search size={20} aria-hidden="true" />
          </button>
        </form>
        <div className="home-intents">
          <Link className="intent" href="/places">
            <Utensils size={22} aria-hidden="true" />
            <span>{t.eat}</span>
          </Link>
          <Link className="intent" href="/events?period=weekend">
            <CalendarDays size={22} aria-hidden="true" />
            <span>{t.weekend}</span>
          </Link>
        </div>
        <div className="category-strip">
          {shortcuts.map(([Icon, label, href]) => (
            <Link key={href} href={href}>
              <Icon size={18} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </div>
      </section>
      <section className="section">
        <SectionHeading
          title={t.popular}
          subtitle={t.popularIntro}
          href="/places"
          t={t}
        />
        <CardGrid
          items={[...feed.featuredPlaces, ...feed.trendingPlaces].slice(0, 6)}
          kind="places"
          mobileRows
          {...{ t, locale }}
          empty={
            <EmptyState
              t={t}
              body={t.noPlacesBody}
              action={{ href: "/places", label: t.exploreLink }}
            />
          }
        />
      </section>
      <section className="section weekend-section">
        <SectionHeading
          title={t.weekend}
          subtitle={t.weekendIntro}
          href="/events?period=weekend"
          t={t}
        />
        <CardGrid
          items={feed.upcomingEvents}
          kind="events"
          {...{ t, locale }}
          empty={
            <EmptyState
              t={t}
              body={t.noEventsBody}
              action={{ href: "/events", label: t.upcomingEvents }}
            />
          }
        />
      </section>
      {flags.products && feed.recentProductSightings.length > 0 && (
        <section className="section">
          <SectionHeading
            title={t.products}
            subtitle={t.findsIntro}
            href="/products"
            t={t}
          />
          <div className="find-grid">
            {feed.recentProductSightings.map((item) => (
              <Link
                className="find-card"
                key={item.id}
                href={"/products/" + item.product_slug}
              >
                <div className="find-image">
                  <Image
                    src={item.product_image}
                    alt={item.product_name}
                    fill
                    sizes="88px"
                  />
                </div>
                <div>
                  <span className="tiny-label">{t.sightings}</span>
                  <h3>{item.product_name}</h3>
                  <p>{item.place_name}</p>
                  <small>
                    {dateLabel(item.observed_at, locale)}
                    {item.is_demo && ` · ${t.demoShort}`}
                  </small>
                </div>
              </Link>
            ))}
          </div>
          <p className="fine-print">{t.inventory}</p>
        </section>
      )}
      {feed.followedOrganizationEvents.length > 0 && (
        <section className="section">
          <SectionHeading title={t.followed} t={t} />
          <CardGrid
            items={feed.followedOrganizationEvents}
            kind="events"
            {...{ t, locale }}
          />
        </section>
      )}
      {flags.submissions && (
        <section className="community-cta">
          <div>
            <h2>{t.join}</h2>
            <p>{t.joinBody}</p>
          </div>
          <Link className="button secondary" href="/submit/place">
            {t.submitPlace}
          </Link>
        </section>
      )}
    </div>
  );
}
