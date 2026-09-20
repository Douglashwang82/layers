import Link from "next/link";
import { Photo as Image } from "@/components/photo";
import { cookies } from "next/headers";
import {
  Search,
  ArrowUpRight,
  Utensils,
  CalendarDays,
  Coffee,
  ShoppingBag,
  Users,
  ArrowRight,
} from "lucide-react";
import { getHomeFeed } from "@/features/catalog/repository";
import { getCopy, getLocale, dateLabel } from "@/lib/i18n";
import { CardGrid, SectionHeading } from "@/components/cards";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
export default async function HomePage() {
  const [t, locale, actor, jar] = await Promise.all([
    getCopy(),
    getLocale(),
    currentActor(),
    cookies(),
  ]);
  const feed = await getHomeFeed(
    jar.get("city")?.value ?? "houston",
    actor?.id,
  );
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="jade-dot" />
            {t.eyebrow}
          </div>
          <h1>
            {locale === "en" ? (
              <>
                Discover Houston
                <br className="desktop-break" /> through <em>Taiwanese</em>
                <br className="desktop-break" /> eyes.
              </>
            ) : (
              t.headline
            )}
          </h1>
          <p>{t.heroBody}</p>
          <form action="/search" className="hero-search">
            <Search size={20} />
            <input
              aria-label={t.searchLabel}
              name="q"
              placeholder={t.searchPlaceholder}
            />
            <button aria-label={t.search}>
              <ArrowRight size={20} />
            </button>
          </form>
          <div className="hero-community">
            <div className="avatar-stack">
              <span>Y</span>
              <span>C</span>
              <span>L</span>
              <span>W</span>
            </div>
            <div>
              <b>{t.intro}</b>
              <small>{t.communityLabel}</small>
            </div>
          </div>
        </div>
        <div className="hero-visual">
          <Image
            src="https://images.unsplash.com/photo-1552611052-33e04de081de?auto=format&fit=crop&w=1400&q=85"
            alt={
              locale === "en"
                ? "A warm bowl of noodles with herbs"
                : "一碗熱騰騰的麵"
            }
            fill
            priority
            sizes="(max-width:768px) 100vw, 50vw"
          />
          <div className="hero-image-shade" />
          <span className="hero-script">好好吃，好好生活</span>
          <div className="hero-photo-caption">
            <span>01 / HOUSTON FIELD NOTES</span>
            <h2>{t.heroTag}</h2>
            <Link href="/places">
              {t.eat}
              <ArrowUpRight size={20} />
            </Link>
          </div>
          <div className="hero-sticker">
            Made of
            <br />
            <b>
              little
              <br />
              connections.
            </b>
            <span>TAIWANHUB ✳ HOUSTON</span>
          </div>
        </div>
      </section>
      <div className="container">
        <div className="category-strip">
          {[
            [Utensils, t.eat, "/places"],
            [CalendarDays, t.weekend, "/events?period=weekend"],
            [Coffee, "Bubble Tea", "/places?category=Bubble+Tea"],
            ...(flags.products ? [[ShoppingBag, t.products, "/products"]] : []),
            ...(flags.organizations
              ? [[Users, t.community, "/organizations"]]
              : []),
          ].map(([Icon, label, href]) => {
            const I = Icon as typeof Utensils;
            return (
              <Link key={String(href)} href={String(href)}>
                <I size={20} />
                {String(label)}
                <ArrowUpRight size={14} />
              </Link>
            );
          })}
        </div>
        <section className="section">
          <SectionHeading
            title={t.popular}
            subtitle={t.popularIntro}
            href="/places"
            t={t}
          />
          <CardGrid
            items={feed.featuredPlaces}
            kind="places"
            {...{ t, locale }}
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
          />
        </section>
        {flags.products && (
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
                      sizes="100px"
                    />
                  </div>
                  <div>
                    <span className="tiny-label">{t.sightings}</span>
                    <h3>{item.product_name}</h3>
                    <p>{item.place_name}</p>
                    <small>
                      {dateLabel(item.observed_at, locale)} · {t.demoShort}
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
        <section className="community-cta">
          <span className="cta-symbol">✳</span>
          <div>
            <span className="eyebrow">TAIWANHUB COMMUNITY</span>
            <h2>{t.join}</h2>
            <p>{t.joinBody}</p>
          </div>
          <Link className="button dark" href="/submit/place">
            {t.submitPlace}
            <ArrowUpRight size={18} />
          </Link>
        </section>
      </div>
    </>
  );
}
