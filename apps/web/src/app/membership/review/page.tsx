import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getCopy } from "@/lib/i18n";
import { getMembershipMe, listNominations } from "@/features/membership/service";
import { ReviewQueue } from "@/components/membership/review-queue";
export default async function MembershipReviewPage() {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?next=/membership/review");
  const [t, me] = await Promise.all([getCopy(), getMembershipMe(actor)]);
  if (!me.reviewer && !me.admin)
    return (
      <div className="container page-bottom">
        <p className="notice notice-warning">{t.membershipReviewerRequired}</p>
      </div>
    );
  const nominations = await listNominations(actor, "review");
  return (
    <div className="container page-bottom">
      <div className="page-header">
        <h1>{t.membershipReviewTitle}</h1>
      </div>
      <ReviewQueue t={t} nominations={nominations} canReject={me.admin} />
    </div>
  );
}
