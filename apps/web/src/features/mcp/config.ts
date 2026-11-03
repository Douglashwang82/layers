/**
 * MCP connector settings shared by the OAuth authorization server
 * (lib/auth.ts) and the MCP resource server (app/api/mcp). The issuer and the
 * resource both derive from BETTER_AUTH_URL so signed tokens, discovery
 * metadata and verification always agree. See docs/guides/mcp-connector.md.
 */
const authOrigin = (
  process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

/** Token `iss` and the authorization server identifier (RFC 8414). */
export const mcpIssuer = `${authOrigin}/api/auth`;
/** The protected resource (RFC 8707/9728): tokens carry it as `aud`. */
export const mcpResource = `${authOrigin}/api/mcp`;

export const MCP_READ_SCOPE = "layers:read";
export const MCP_WRITE_SCOPE = "layers:write";
/** Scopes the authorization server offers; offline_access enables refresh tokens. */
export const mcpScopes = [
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  "offline_access",
] as const;

/**
 * Off by default: while disabled, the MCP endpoint answers 404 and dynamic
 * client registration is closed, so no third-party client can enrol.
 */
export const mcpEnabled = () => process.env.FEATURE_MCP_CONNECTOR === "true";
