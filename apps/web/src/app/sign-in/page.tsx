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
    <div className="auth-page auth-page-stage">
      <div className="auth-stage">
        <div className="auth-scene" aria-hidden="true">
          <MapLayersAnimation />
        </div>
        <div className="form-panel">
          <AuthForm
            t={t}
            next={query.next ?? "/"}
            google={
              !!process.env.GOOGLE_CLIENT_ID &&
              !!process.env.GOOGLE_CLIENT_SECRET
            }
          />
        </div>
      </div>
    </div>
  );
}
