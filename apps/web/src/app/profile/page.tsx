import Link from "next/link";
import { redirect } from "next/navigation";
import { pool } from "@taiwanhub/database";
import { currentActor } from "@/lib/session";
import { getCopy } from "@/lib/i18n";
import { getCities } from "@/features/catalog/repository";
import { ProfileForm } from "@/components/profile-form";
import { SignOut } from "@/components/auth-form";
import { isModerator } from "@taiwanhub/shared";
import { flags } from "@/lib/config";
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
    <div className="container page-bottom">
      <div className="page-header">
        <h1>{t.account}</h1>
        <p>{t.privacy}</p>
      </div>
      <div className="settings-layout">
        <section className="form-panel" aria-labelledby="settings-heading">
          <h2 id="settings-heading">{t.settings}</h2>
          <ProfileForm {...{ t, cities }} user={result.rows[0]} />
        </section>
        <nav className="settings-rows" aria-label={t.profile}>
          <Link className="settings-row" href="/saved">
            {t.saved} <span aria-hidden="true">→</span>
          </Link>
          <Link className="settings-row" href="/layers?tab=mine">
            {t.layers} <span aria-hidden="true">→</span>
          </Link>
          <Link className="settings-row" href="/layers?tab=groups">
            {t.groups} <span aria-hidden="true">→</span>
          </Link>
          <Link className="settings-row" href="/profile/contributions">
            {t.contributions} <span aria-hidden="true">→</span>
          </Link>
          {flags.submissions && (
            <>
              <Link className="settings-row" href="/submit/place">
                {t.submitPlace} <span aria-hidden="true">→</span>
              </Link>
              <Link className="settings-row" href="/submit/event">
                {t.submitEvent} <span aria-hidden="true">→</span>
              </Link>
              {flags.content && (
                <Link className="settings-row" href="/submit/content">
                  {t.shareTip} <span aria-hidden="true">→</span>
                </Link>
              )}
            </>
          )}
          {isModerator(actor.role) && (
            <Link className="settings-row" href="/admin">
              {t.admin} <span aria-hidden="true">→</span>
            </Link>
          )}
          <div className="settings-row">
            <SignOut label={t.signOut} />
          </div>
        </nav>
      </div>
    </div>
  );
}
