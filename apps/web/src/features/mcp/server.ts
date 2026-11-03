import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { brand, type Actor } from "@taiwanhub/shared";
import { trackEvent } from "@/lib/analytics";
import {
  hasScope,
  toolError,
  toolHandlers,
  toolInputs,
  toolMeta,
  type ToolName,
} from "./tools";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

/**
 * One MCP server per request (stateless Streamable HTTP), bound to the
 * verified member and the scopes their token carries. Tools the token cannot
 * use are not listed at all.
 */
export function createMcpServer(actor: Actor, scopes: string[]) {
  const server = new McpServer({ name: brand.name, version: "1.0.0" });
  for (const name of Object.keys(toolInputs) as ToolName[]) {
    if (!hasScope(scopes, name)) continue;
    const meta = toolMeta[name];
    const schema = toolInputs[name];
    server.registerTool(
      name,
      {
        title: meta.title,
        description: meta.description,
        inputSchema: schema.shape,
        annotations: meta.annotations,
      },
      async (args: unknown) => {
        try {
          const input = schema.parse(args);
          const result = await (
            toolHandlers[name] as (a: Actor, i: unknown) => Promise<unknown>
          )(actor, input);
          // Tool name only: no arguments, links or results in analytics.
          await trackEvent("mcp_tool_called", { tool: name }, actor.id);
          return text(result);
        } catch (error) {
          const failure = toolError(error);
          if (failure.code === "INTERNAL_ERROR") console.error(error);
          return { ...text({ error: failure }), isError: true };
        }
      },
    );
  }
  return server;
}
