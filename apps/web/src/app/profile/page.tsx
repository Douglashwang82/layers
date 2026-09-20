import Link from "next/link";
import { redirect } from "next/navigation";
import { pool } from "@taiwanhub/database";
import { currentActor } from "@/lib/session";
import { getCopy } from "@/lib/i18n";
import { getCities } from "@/features/catalog/repository";
import { ProfileForm } from "@/components/profile-form";
import { SignOut } from "@/components/auth-form";
import { isModerator } from "@taiwanhub/shared";
export default async function Profile() {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?next=/profile");
  const [t, cities, result] = await Promise.all([
    getCopy(),
    getCities(),
    pool.query<{
      name: string;
      bio: string | null;
      preferredLanguage: string;
      homeCityId: string | null;
    }>(
      'SELECT name,bio,preferred_language AS "preferredLanguage",home_city_id AS "homeCityId" FROM "user" WHERE id=$1',
      [actor.id],
    ),
  ]);
  return (
    <div className="container">
      <div className="form-panel">
        <h1>{t.account}</h1>
        <p>{t.privacy}</p>
        <ProfileForm {...{ t, cities }} user={result.rows[0]} />
        <div className="actions">
          <Link className="button secondary" href="/profile/contributions">
            {t.contributions}
          </Link>
          {isModerator(actor.role) && (
            <Link className="button secondary" href="/admin">
              {t.admin}
            </Link>
          )}
          <SignOut label={t.signOut} />
        </div>
        <div className="actions">
          <Link href="/submit/event" className="text-button">
            {t.submitEvent}
          </Link>
          <Link href="/submit/place" className="text-button">
            {t.submitPlace}
          </Link>
        </div>
      </div>
    </div>
  );
}
