import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Route } from "lucide-react";
import { getLocale } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import { tripCopy } from "@/lib/trip-copy";
import { listTrips } from "@/features/trips/service";

export const metadata: Metadata = { title: "Trips", robots: { index: false } };

/** The signed-in member's trips, private and group (docs/plans/trip-scheduler-design.md). */
export default async function TripsPage() {
  if (!flags.trips) notFound();
  const [actor, locale] = await Promise.all([currentActor(), getLocale()]);
  const t = tripCopy(locale);
  if (!actor)
    return (
      <div className="container page-bottom">
        <div className="empty">
          <h1>{t.trips}</h1>
          <p>{t.signInToPlan}</p>
          <Link className="button" href="/sign-in?next=/trips">
            {t.signIn}
          </Link>
        </div>
      </div>
    );
  const { trips } = await listTrips(actor);
  return (
    <div className="container page-bottom">
      <div className="page-header">
        <h1>{t.trips}</h1>
        <p>{t.tripsIntro}</p>
      </div>
      {trips.length === 0 ? (
        <div className="empty">
          <Route size={24} aria-hidden="true" />
          <p>{t.noTrips}</p>
        </div>
      ) : (
        <ul className="trip-list">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Link href={`/trips/${trip.id}`}>
                <strong>{trip.title}</strong>
              </Link>
              <span className="muted">
                {trip.startsOn === trip.endsOn
                  ? trip.startsOn
                  : `${trip.startsOn} – ${trip.endsOn}`}{" "}
                · {trip.cityName} · {t.stops(trip.stopCount)} ·{" "}
                {trip.audience === "group"
                  ? t.groupTrip(trip.ownerName)
                  : t.privateTrip}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
