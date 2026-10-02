import { getCopy } from "@/lib/i18n";
import { AuthForm } from "@/components/auth-form";
import { SignInPet } from "@/components/mascot/sign-in-pet";
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [t, query] = await Promise.all([getCopy(), searchParams]);
  return (
    <div className="auth-page auth-page-stage">
      <div className="auth-stage">
        {/* Right third: a clean sign-in section, first in reading and tab order. */}
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
        {/* Left two thirds (placed by CSS): the lit pet stage and its pause. */}
        <div className="auth-scene">
          <SignInPet pauseLabel={t.signInPetPause} />
        </div>
      </div>
    </div>
  );
}
