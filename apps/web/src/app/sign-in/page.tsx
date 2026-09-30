import { getCopy } from "@/lib/i18n";
import { AuthForm } from "@/components/auth-form";
import { MapLayersAnimation } from "@/components/map-layers-animation";
/** Fixed positions so server and client render the same motes. */
const MOTES = [
  {
    "--x": "8%",
    "--y": "18%",
    "--size": "3px",
    "--speed": "16s",
    "--phase": "-2s",
  },
  {
    "--x": "22%",
    "--y": "72%",
    "--size": "2px",
    "--speed": "13s",
    "--phase": "-7s",
  },
  {
    "--x": "31%",
    "--y": "12%",
    "--size": "4px",
    "--speed": "18s",
    "--phase": "-4s",
  },
  {
    "--x": "46%",
    "--y": "84%",
    "--size": "3px",
    "--speed": "15s",
    "--phase": "-9s",
  },
  {
    "--x": "58%",
    "--y": "22%",
    "--size": "2px",
    "--speed": "12s",
    "--phase": "-1s",
  },
  {
    "--x": "67%",
    "--y": "64%",
    "--size": "3px",
    "--speed": "17s",
    "--phase": "-6s",
  },
  {
    "--x": "12%",
    "--y": "48%",
    "--size": "2px",
    "--speed": "14s",
    "--phase": "-11s",
  },
  {
    "--x": "40%",
    "--y": "40%",
    "--size": "2px",
    "--speed": "19s",
    "--phase": "-3s",
  },
  {
    "--x": "75%",
    "--y": "36%",
    "--size": "4px",
    "--speed": "16s",
    "--phase": "-8s",
  },
  {
    "--x": "84%",
    "--y": "78%",
    "--size": "3px",
    "--speed": "13s",
    "--phase": "-5s",
  },
  {
    "--x": "92%",
    "--y": "14%",
    "--size": "2px",
    "--speed": "15s",
    "--phase": "-10s",
  },
  {
    "--x": "54%",
    "--y": "56%",
    "--size": "3px",
    "--speed": "18s",
    "--phase": "-12s",
  },
];
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
          {MOTES.map((mote, index) => (
            <span
              key={index}
              className="auth-mote"
              style={mote as React.CSSProperties}
            />
          ))}
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
