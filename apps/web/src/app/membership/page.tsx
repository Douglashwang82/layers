import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getCopy } from "@/lib/i18n";
import { getMembershipMe } from "@/features/membership/service";
import { NominateForm } from "@/components/membership/nominate-form";
import { MyNominations } from "@/components/membership/my-nominations";
export default async function MembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const [actor, { email }] = await Promise.all([currentActor(), searchParams]);
  if (!actor)
    redirect(
      `/sign-in?next=${encodeURIComponent(
        email ? `/membership?email=${encodeURIComponent(email)}` : "/membership",
      )}`,
    );
  const [t, me] = await Promise.all([getCopy(), getMembershipMe(actor)]);
  return (
    <div className="container page-bottom">
      <div className="page-header">
        <h1>{t.membershipTitle}</h1>
      </div>
      <div className="settings-layout">
        <section className="form-panel" aria-labelledby="nominate-heading">
          <h2 id="nominate-heading">{t.membershipNominateTitle}</h2>
          <p className="muted">{t.membershipNominateBody}</p>
          <NominateForm t={t} defaultEmail={email} />
        </section>
        <section aria-labelledby="mine-heading">
          <h2 id="mine-heading">{t.membershipMineTitle}</h2>
          <MyNominations t={t} nominations={me.nominations} />
          {(me.reviewer || me.admin) && (
            <Link className="settings-row" href="/membership/review">
              {t.membershipReviewTitle} <span aria-hidden="true">→</span>
            </Link>
          )}
        </section>
      </div>
    </div>
  );
}
