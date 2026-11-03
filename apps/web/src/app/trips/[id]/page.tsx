import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { AppError } from "@taiwanhub/shared";
import { getLocale } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import { tripCopy } from "@/lib/trip-copy";
import { getTripView } from "@/features/trips/service";
import { TripPlanner } from "@/components/trips/trip-planner";

export const metadata: Metadata = { title: "Trip", robots: { index: false } };

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!flags.trips) notFound();
  const [{ id }, actor, locale] = await Promise.all([
    params,
    currentActor(),
    getLocale(),
  ]);
  const t = tripCopy(locale);
  const view = await getTripView(id, actor).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) return null;
    throw e;
  });
  if (!view)
    return (
      <div className="container page-bottom">
        <div className="empty">
          <Lock size={24} aria-hidden="true" />
          <h1>{t.trips}</h1>
          <p>{actor ? t.noTrips : t.signInToPlan}</p>
          <Link
            className="button secondary"
            href={actor ? "/trips" : `/sign-in?next=/trips/${id}`}
          >
            {actor ? t.backToTrips : t.signIn}
          </Link>
        </div>
      </div>
    );
  return (
    <TripPlanner
      initial={view}
      locale={locale}
      mapToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN || undefined}
    />
  );
}
