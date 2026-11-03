"use client";
import { useState } from "react";
import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import type { McpConsentCopy } from "@/lib/mcp-copy";

// The plugin attaches this page's signed query (oauth_query) to the request.
const client = createAuthClient({ plugins: [oauthProviderClient()] });

export function ConsentForm({
  t,
  denyOnly = false,
}: {
  t: McpConsentCopy;
  denyOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function decide(accept: boolean) {
    setBusy(true);
    setError(false);
    try {
      const result = await client.oauth2.consent({ accept });
      const url = (result.data as { url?: unknown } | null)?.url;
      if (result.error || typeof url !== "string") {
        setError(true);
        setBusy(false);
        return;
      }
      // Back to the connector with a code (or access_denied).
      window.location.assign(url);
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <div className="form-stack">
      {!denyOnly && (
        <button
          type="button"
          className="button"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void decide(true)}
        >
          {busy ? t.working : t.allow}
        </button>
      )}
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() => void decide(false)}
      >
        {t.deny}
      </button>
      {error && <p role="alert">{t.failed}</p>}
    </div>
  );
}
