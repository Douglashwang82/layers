import type { Metadata } from "next";
import Link from "next/link";
import { getCopy, getLocale, format } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { getInviteByToken } from "@/features/groups/repository";
import { AcceptInviteButton } from "@/components/groups/group-management";
import { roleLabel } from "@/lib/layer-labels";
export const metadata: Metadata = {
  title: "Invitation",
  robots: { index: false },
};
/** The token bearer sees the group name; joining still requires the invited account. */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [{ token }, t, locale, actor] = await Promise.all([
    params,
    getCopy(),
    getLocale(),
    currentActor(),
  ]);
  const invite = /^[a-f0-9]{64}$/.test(token)
    ? await getInviteByToken(token)
    : null;
  const name = invite
    ? locale === "zh-TW" && invite.groupNameChinese
      ? invite.groupNameChinese
      : invite.groupName
    : "";
  return (
    <div className="container page-bottom">
      <div className="form-panel form-stack">
        <h1>{t.groups}</h1>
        {!invite || !invite.valid ? (
          <>
            <p className="notice notice-warning">{t.inviteInvalid}</p>
            {invite?.accepted && (
              <Link
                className="button secondary"
                href={`/groups/${invite.groupSlug}`}
              >
                {name}
              </Link>
            )}
          </>
        ) : (
          <>
            <p>
              {format(t.inviteFor, {
                group: name,
                role: roleLabel(invite.role, t),
              })}
            </p>
            {actor ? (
              <div className="actions">
                <AcceptInviteButton token={token} t={t} />
              </div>
            ) : (
              <>
                <p className="muted">{t.inviteSignIn}</p>
                <div className="actions">
                  <Link
                    className="button"
                    href={`/sign-in?next=${encodeURIComponent(`/groups/join/${token}`)}`}
                  >
                    {t.signIn}
                  </Link>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
