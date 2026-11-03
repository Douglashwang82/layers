import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getLocale } from "@/lib/i18n";
import { messagingEn, messagingZh } from "@/lib/messaging-copy";
import {
  chatCaptureEnabled,
  listConnections,
} from "@/features/messaging/service";
import {
  ConnectionsPanel,
  type ConnectionsData,
} from "@/components/messaging/connections-panel";
export const metadata = {
  title: "Send places from chat",
  robots: { index: false },
};
export default async function ConnectionsPage() {
  if (!chatCaptureEnabled()) notFound();
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?next=/profile/connections");
  const [locale, data] = await Promise.all([
    getLocale(),
    listConnections(actor),
  ]);
  const t = locale === "zh-TW" ? messagingZh : messagingEn;
  return (
    <div className="container page-bottom">
      <nav>
        <Link href="/profile">{t.back}</Link>
      </nav>
      <div className="page-header">
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
      </div>
      <ConnectionsPanel
        locale={locale === "zh-TW" ? "zh-TW" : "en"}
        initial={JSON.parse(JSON.stringify(data)) as ConnectionsData}
      />
    </div>
  );
}
