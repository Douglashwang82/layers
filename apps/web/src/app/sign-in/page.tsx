import { getCopy } from "@/lib/i18n";
import { AuthForm } from "@/components/auth-form";
import { MapLayersAnimation } from "@/components/map-layers-animation";
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [t, query] = await Promise.all([getCopy(), searchParams]);
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <MapLayersAnimation />
        <h2>{t.authIntro}</h2>
        <p>{t.authBody}</p>
      </aside>
      <div className="form-panel">
        <AuthForm
          t={t}
          next={query.next ?? "/"}
          google={
            !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET
          }
        />
      </div>
    </div>
  );
}
