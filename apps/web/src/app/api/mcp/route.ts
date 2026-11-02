import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { mcpEnabled } from "@/features/mcp/config";
import { authenticateMcpRequest, unauthorized } from "@/features/mcp/auth";
import { createMcpServer } from "@/features/mcp/server";

/*
 * Remote MCP endpoint for ChatGPT and Claude connectors
 * (docs/guides/mcp-connector.md). Stateless Streamable HTTP: every request is
 * authenticated with an OAuth access token and served by a fresh server.
 */
export const dynamic = "force-dynamic";
// Adding places resolves Google links, which can take a while.
export const maxDuration = 60;

const MAX_BODY_BYTES = 65536;

function tooLarge() {
  return new Response("Request is too large.", { status: 413 });
}
function notFound() {
  return new Response("Not found", { status: 404 });
}

async function handle(request: Request) {
  if (!mcpEnabled()) return notFound();
  const principal = await authenticateMcpRequest(request);
  if (!principal) return unauthorized();
  let parsedBody: unknown;
  if (request.method === "POST") {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
      return tooLarge();
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return tooLarge();
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error" },
          id: null,
        },
        { status: 400 },
      );
    }
  }
  const server = createMcpServer(principal.actor, principal.scopes);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { parsedBody });
  } finally {
    // JSON responses are complete once returned; nothing streams afterwards.
    void server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
