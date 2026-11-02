import { redirect } from "next/navigation";
import { brand } from "@taiwanhub/shared";
import { currentActor, currentSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n";
import { format } from "@/lib/dictionary";
import { mcpConsentEn, mcpConsentZh } from "@/lib/mcp-copy";
import { getConsentClient } from "@/features/mcp/repository";
import { mcpEnabled } from "@/features/mcp/config";
import { ConsentForm } from "@/components/mcp/consent-form";

export const metadata = { robots: { index: false } };

/**
 * OAuth consent for MCP connectors. The OAuth provider redirects here with a
 * signed query; Allow/Deny posts that query back, and the provider's own
 * signature check is what authorizes it. This page only displays the request.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [locale, query, session, actor] = await Promise.all([
    getLocale(),
    searchParams,
    currentSession(),
    currentActor(),
  ]);
  const t = locale === "zh-TW" ? mcpConsentZh : mcpConsentEn;
  const one = (v: string | string[] | undefined) =>
    typeof v === "string" ? v : undefined;
  const clientId = one(query.client_id);
  const client =
    mcpEnabled() && clientId && one(query.sig)
      ? await getConsentClient(clientId)
      : null;
  if (!client)
    return (
      <Panel title={t.pageTitle}>
        <p role="alert">{t.invalid}</p>
      </Panel>
    );
  if (!session) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      for (const v of [value].flat())
        if (v !== undefined) params.append(key, v);
    redirect(`/sign-in?${params.toString()}`);
  }
  if (!actor)
    return (
      <Panel title={t.pageTitle}>
        <p role="alert">{format(t.notMember, { brand: brand.name })}</p>
        <ConsentForm t={t} denyOnly />
      </Panel>
    );
  const name = client.name?.trim() || t.unknownClient;
  // Show where the member returns to, but only a URI the client registered.
  const requested = one(query.redirect_uri);
  const returnUri = client.redirectUris.includes(requested ?? "")
    ? requested
    : undefined;
  let host: string | undefined;
  try {
    if (returnUri) host = new URL(returnUri).host;
  } catch {}
  const scopes = new Set((one(query.scope) ?? "").split(" "));
  return (
    <Panel title={format(t.title, { client: name, brand: brand.name })}>
      <p>{format(t.intro, { client: name, brand: brand.name })}</p>
      <h2>{t.scopesHeading}</h2>
      <ul>
        {(scopes.has("layers:read") || scopes.has("layers:write")) && (
          <li>{t.scopeRead}</li>
        )}
        {scopes.has("layers:write") && <li>{t.scopeWrite}</li>}
        {scopes.has("offline_access") && <li>{t.scopeOffline}</li>}
      </ul>
      {host && <p>{format(t.returnsTo, { host })}</p>}
      <p>{t.trust}</p>
      <ConsentForm t={t} />
    </Panel>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-page">
      <div className="form-panel">
        <div className="form-stack">
          <h1>{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
