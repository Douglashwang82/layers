import { getCopy } from "@/lib/i18n";
import { AuthForm } from "@/components/auth-form";
import { SignInPattern } from "@/components/sign-in-pattern";
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [t, query] = await Promise.all([getCopy(), searchParams]);
  return (
    <div className="auth-page auth-page-stage">
      <div className="auth-stage">
        {/* The form stays first in reading order; the brand side sits to its left on desktop. */}
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
        <div className="auth-brand-side">
          {/* Real text, outside the decorative artwork so it stays accessible. */}
          <div className="auth-story">
            <p className="auth-story__title">{t.authStoryTitle}</p>
            <p className="auth-story__meta">{t.authStoryMeta}</p>
          </div>
          {/* Decorative monochrome pattern; form stays first in tab order. */}
          <div className="auth-scene">
            <SignInPattern pauseLabel={t.signInPetPause} />
          </div>
        </div>
      </div>
    </div>
  );
}
