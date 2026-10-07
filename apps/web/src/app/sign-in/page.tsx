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
        {/* The form occupies 40% on desktop and stays first in reading order. */}
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
        {/* Decorative monochrome pattern; form stays first in tab order. */}
        <div className="auth-scene">
          <SignInPattern pauseLabel={t.signInPetPause} />
        </div>
      </div>
    </div>
  );
}
