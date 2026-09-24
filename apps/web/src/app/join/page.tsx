import type { Metadata } from "next";
import { getCopy, getLocale } from "@/lib/i18n";
import { JoinFlow } from "@/components/membership/join-flow";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Join TaiwanHub",
  robots: { index: false, follow: false },
};
export default async function JoinPage() {
  const [t, locale] = await Promise.all([getCopy(), getLocale()]);
  return (
    <div className="container page-bottom">
      <JoinFlow t={t} locale={locale} />
    </div>
  );
}
