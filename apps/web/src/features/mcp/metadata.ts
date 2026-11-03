import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { brand } from "@taiwanhub/shared";
import { auth } from "@/lib/auth";
import { mcpEnabled, mcpIssuer, mcpResource, mcpScopes } from "./config";

/*
 * OAuth discovery documents for MCP clients. The authorization server's
 * issuer is `<origin>/api/auth`, so its RFC 8414 metadata lives at
 * `/.well-known/oauth-authorization-server/api/auth` (with a root alias for
 * clients that only try the root). The MCP resource's RFC 9728 metadata is
 * served at the path-inserted URL and the root.
 */

const notFound = () => new Response("Not found", { status: 404 });
const serveAuthServer = oauthProviderAuthServerMetadata(auth);

export async function authorizationServerMetadata(request: Request) {
  if (!mcpEnabled()) return notFound();
  return serveAuthServer(request);
}

export function protectedResourceMetadata() {
  if (!mcpEnabled()) return notFound();
  return Response.json(
    {
      resource: mcpResource,
      resource_name: brand.name,
      authorization_servers: [mcpIssuer],
      scopes_supported: [...mcpScopes],
      bearer_methods_supported: ["header"],
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
