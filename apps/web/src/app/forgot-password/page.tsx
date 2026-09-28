import { getCopy } from "@/lib/i18n";
import { ForgotPasswordForm } from "@/components/auth-form";
export default async function ForgotPasswordPage() {
  const t = await getCopy();
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
          <h1>{t.forgotPasswordTitle}</h1>
          <ForgotPasswordForm t={t} />
        </div>
      </div>
    </div>
  );
}
