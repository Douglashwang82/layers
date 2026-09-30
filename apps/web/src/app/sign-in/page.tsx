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
        <div className="auth-scene-story">
          <p className="auth-scene-eyebrow">
            <span />
            {t.signInSceneEyebrow}
          </p>
          <h2>
            {t.signInSceneTitle}
            <br />
            <em>{t.signInSceneAccent}</em>
          </h2>
          <p className="auth-scene-description">{t.signInSceneDescription}</p>
        </div>
        <p className="auth-scene-caption">
          <span />
          {t.signInSceneFooter}
          <span className="auth-scene-caption-line" />
        </p>
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
