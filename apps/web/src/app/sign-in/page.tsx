import { getCopy } from "@/lib/i18n";
import { AuthForm } from "@/components/auth-form";
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [t, query] = await Promise.all([getCopy(), searchParams]);
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <span className="brand-mark" aria-hidden="true">
          台
        </span>
        <h2>{t.authIntro}</h2>
        <p>{t.authBody}</p>
      </aside>
      <div className="form-panel">
        <AuthForm
          t={t}
          next={query.next ?? "/"}
          google={!!process.env.GOOGLE_CLIENT_ID}
        />
      </div>
    </div>
  );
}
