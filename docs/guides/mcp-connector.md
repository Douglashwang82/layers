# MCP connector (ChatGPT and Claude)

Members can add LocalLink to ChatGPT or Claude as a remote MCP connector and
ask the assistant to read and edit their layers ("what's on my Weekend layer?",
"add this Google Maps link to my Boba layer"). The assistant acts as that
member. It sees and changes only what the member could on the site.

## How it works

| Piece                   | Where                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth 2.1 server        | `@better-auth/oauth-provider` + `jwt` plugins in `apps/web/src/lib/auth.ts`                                                                               |
| Discovery documents     | `apps/web/src/app/.well-known/*`, `apps/web/src/features/mcp/metadata.ts`                                                                                 |
| Consent screen          | `/oauth/consent` (`apps/web/src/app/oauth/consent/page.tsx`)                                                                                              |
| MCP endpoint            | `/api/mcp` (`apps/web/src/app/api/mcp/route.ts`)                                                                                                          |
| Token check + tools     | `apps/web/src/features/mcp/{auth,server,tools}.ts`                                                                                                        |
| Tables (migration 0034) | `jwks`, `oauth_client`, `oauth_access_token`, `oauth_refresh_token`, `oauth_consent`, `oauth_resource`, `oauth_client_resource`, `oauth_client_assertion` |

1. The client calls `/api/mcp`, gets `401` with
   `WWW-Authenticate: Bearer resource_metadata=…`, and reads
   `/.well-known/oauth-protected-resource/api/mcp`, then
   `/.well-known/oauth-authorization-server/api/auth`.
2. It registers itself (`POST /api/auth/oauth2/register`, RFC 7591, a public
   PKCE client) and sends the member to `/api/auth/oauth2/authorize` with
   `resource=<origin>/api/mcp`.
3. A signed-out member lands on `/sign-in`. The sign-in form forwards the
   signed OAuth query (`oauth_query`) with the email code, password or Google
   sign-in, so the invitation and admission gates stay the same. The server
   then continues to `/oauth/consent`.
4. On Allow, the client exchanges the code (PKCE) for a one-hour JWT access
   token (`aud` = the MCP resource) and a 30-day refresh token.
5. Every MCP request verifies the token locally (signature from `jwks`,
   issuer, audience, expiry). It then rechecks that the subject is an
   admitted member and reads their role from the database. Losing admission
   cuts access on the next call.

Scopes: `layers:read` (list and read layers), `layers:write` (create layers,
add and remove places), `offline_access` (refresh tokens). Tools a token's
scopes don't cover are not listed.

## Tools

| Tool                      | Scope | Wraps                                                        |
| ------------------------- | ----- | ------------------------------------------------------------ |
| `list_layers`             | read  | `listLibrary` (mine, groups, following, discover)            |
| `get_layer_places`        | read  | `getLayer` + `runMapQuery` (at most 100 places per response) |
| `create_layer`            | write | `resolveGoogleLinks` + `createLayerFromGoogle`               |
| `add_places_to_layer`     | write | `resolveGoogleLinks` + `importGooglePlaces`                  |
| `remove_place_from_layer` | write | `removeLayerItem`                                            |

Write tools use the contribution limit (30 per minute) and the Google link
budget. As with chat capture, only Google Maps results are added; Instagram
captions are reported back but never added. Analytics records
`mcp_tool_called` with the tool name only.

## Enable it

1. Apply migration `0034` (`pnpm db:migrate`) to the target database.
2. Set `FEATURE_MCP_CONNECTOR=true`. Set `BETTER_AUTH_URL` to the public
   HTTPS origin (for example `https://www.zongly.com`): the issuer and
   resource both come from it, and tokens signed under one origin do not
   verify under another.
3. Check `https://<host>/.well-known/oauth-protected-resource/api/mcp`.

While the flag is off, `/api/mcp` and the discovery documents return 404 and
client registration is refused.

## Connect a client

- **Claude**: Settings → Connectors → Add custom connector → URL
  `https://<host>/api/mcp`. Then sign in and allow access.
- **ChatGPT**: turn on developer mode, then create a connector/app with the
  same URL and OAuth authentication.
- **Local testing**: `npx @modelcontextprotocol/inspector` against
  `http://localhost:3000/api/mcp`. Loopback HTTP works only locally.

Each product's menu names and plan requirements change over time; follow its
current documentation. Publishing to the OpenAI or Anthropic directories
needs their own review.

## Known limits

- Members have no "connected apps" page yet, so they cannot revoke access
  themselves. To revoke, delete the member's `oauth_consent` and
  `oauth_refresh_token` rows for that client. Issued JWT access tokens stay
  valid until they expire (at most one hour), but revoking admission blocks
  them right away.
- Dynamic registration is open while the flag is on; any client can register
  under any name. The consent screen shows the registered name and the
  redirect host so members can tell clients apart.
- Client ID metadata documents (CIMD), DPoP-bound tokens and MCP Apps
  widgets are not implemented. Tokens carrying `cnf` are rejected.
- `@better-auth/mcp` exists only as a 1.8 beta. This setup uses the stable
  1.7.5 `oauth-provider` package.
