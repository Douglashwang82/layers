import Link from "next/link";
import { isModerator } from "@taiwanhub/shared";
import { currentActor } from "@/lib/session";
import { getCopy, getLocale } from "@/lib/i18n";
import { mapImportEn, mapImportZh } from "@/lib/map-import-copy";
import { messagingEn, messagingZh } from "@/lib/messaging-copy";
import { flags } from "@/lib/config";
import { AccountSignInLink } from "./sign-in-link";
import { LayerLink } from "@/components/layers/workspace-navigation";
import { getCities } from "@/features/catalog/repository";
import { getProfileSettings } from "@/features/profile/repository";
import { chatCaptureEnabled } from "@/features/messaging/service";
import { ProfileForm } from "@/components/profile-form";
import { SignOut } from "@/components/auth-form";

/**
 * The map's right-hand account sidebar body (`?account=1`): what /profile
 * used to be. The settings form is inline; everything else links out.
 */
export async function AccountScreen() {
  const [actor, t, locale] = await Promise.all([
    currentActor(),
    getCopy(),
    getLocale(),
  ]);
  if (!actor)
    return (
      <div className="account-screen">
        <p>{t.accountSignInPrompt}</p>
        <AccountSignInLink label={t.signIn} />
      </div>
    );
  const importCopy = locale === "zh-TW" ? mapImportZh : mapImportEn;
  const chatCopy = locale === "zh-TW" ? messagingZh : messagingEn;
  const [cities, user] = await Promise.all([
    getCities(),
    getProfileSettings(actor.id),
  ]);
  return (
    <div className="account-screen">
      <p className="muted">{t.privacy}</p>
      {user && (
        <section aria-labelledby="account-settings-heading">
          <h3 id="account-settings-heading">{t.settings}</h3>
          <ProfileForm {...{ t, cities, user }} />
        </section>
      )}
      <nav className="settings-rows" aria-label={t.profile}>
        {flags.layerWrites && flags.layerCustomPlaces && (
          <Link className="settings-row" href="/map-import">
            {importCopy.title} <span aria-hidden="true">→</span>
          </Link>
        )}
        {chatCaptureEnabled() && (
          <Link className="settings-row" href="/profile/connections">
            {chatCopy.title} <span aria-hidden="true">→</span>
          </Link>
        )}
        {flags.layerCustomPlaces && (
          <Link className="settings-row" href="/layer-collections">
            {importCopy.collections} <span aria-hidden="true">→</span>
          </Link>
        )}
        <Link className="settings-row" href="/saved">
          {t.saved} <span aria-hidden="true">→</span>
        </Link>
        {/* Layer screens open in the map's left panel, keeping the map state. */}
        <LayerLink className="settings-row" href="/layers?tab=mine">
          {t.layers} <span aria-hidden="true">→</span>
        </LayerLink>
        <LayerLink className="settings-row" href="/layers?tab=groups">
          {t.groups} <span aria-hidden="true">→</span>
        </LayerLink>
        <Link className="settings-row" href="/profile/contributions">
          {t.contributions} <span aria-hidden="true">→</span>
        </Link>
        <Link className="settings-row" href="/membership">
          {t.membershipTitle} <span aria-hidden="true">→</span>
        </Link>
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
  );
}
