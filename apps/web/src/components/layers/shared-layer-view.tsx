import Link from "next/link";
import { Lock } from "lucide-react";
import { type Copy, type Locale, dateLabel, format } from "@/lib/dictionary";
import type { SharedLayerView } from "@/features/layers/share-links";
import { localizedCityName } from "@taiwanhub/shared";

/**
 * Read-only view of a link-shared layer. Server-rendered and token-blind: it
 * never receives the token, reviews, members or notes, and it deliberately
 * uses plain links (no `next`/return path) so the secret never leaves the URL.
 */
export function SharedLayerScreen({
  view,
  locale,
  t,
  signedIn,
  hasAccess,
}: {
  view: SharedLayerView;
  locale: Locale;
  t: Copy;
  signedIn: boolean;
  hasAccess: boolean;
}) {
  const zh = locale === "zh-TW";
  const title = (zh && view.titleChinese) || view.title;
  const description = (zh && view.descriptionChinese) || view.description;
  const city = localizedCityName(
    { slug: view.citySlug, name: view.cityName },
    locale,
  );
  return (
    <div className="container page-bottom">
      <header className="layer-detail-header">
        <h1>{title}</h1>
        <p className="muted">
          {format(t.sharedViewBy, { name: view.ownerName })} · {city}
        </p>
        {description && <p>{description}</p>}
        <p className="notice">{t.sharedViewReadOnly}</p>
      </header>
      <section className="section" aria-labelledby="shared-places-heading">
        <h2 id="shared-places-heading">{t.places}</h2>
        {view.places.length === 0 ? (
          <div className="empty">
            <p>{t.sharedViewNoPlaces}</p>
          </div>
        ) : (
          <ul className="shared-place-list">
            {view.places.map((place) => (
              <li key={place.id}>
                <h3>{(zh && place.nameChinese) || place.name}</h3>
                {place.address && <p className="muted">{place.address}</p>}
                {place.googleMapsUrl && (
                  <a
                    className="text-button"
                    href={place.googleMapsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {t.routeOpen}
                  </a>
                )}
                {place.events.length > 0 && (
                  <ul className="fine-print">
                    {place.events.map((event, index) => (
                      <li key={index}>
                        {(zh && event.titleChinese) || event.title} ·{" "}
                        {dateLabel(event.startTime, locale, view.timezone)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="notice" aria-label={t.sharedViewReadOnly}>
        <p>{format(t.sharedViewCta, { name: view.ownerName })}</p>
        <div className="actions">
          {!signedIn && (
            <Link className="button secondary" href="/sign-in">
              {t.signIn}
            </Link>
          )}
          {hasAccess && (
            <Link
              className="button secondary"
              href={`/layers/${encodeURIComponent(view.slug)}`}
            >
              {t.sharedViewOpenInMap}
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}

export function SharedLayerUnavailable({ t }: { t: Copy }) {
  return (
    <div className="container page-bottom">
      <div className="empty">
        <Lock size={24} aria-hidden="true" />
        <h1>{t.sharedViewUnavailable}</h1>
        <p>{t.sharedViewUnavailableHelp}</p>
      </div>
    </div>
  );
}
