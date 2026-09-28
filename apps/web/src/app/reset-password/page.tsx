import { getCopy } from "@/lib/i18n";
import { ResetPasswordForm } from "@/components/auth-form";
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
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
        <div className="form-stack">
          <h1>{t.resetPasswordTitle}</h1>
          <ResetPasswordForm t={t} token={query.token} />
        </div>
      </div>
    </div>
  );
}
