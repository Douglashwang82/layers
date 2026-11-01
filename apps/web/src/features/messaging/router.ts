import { NextResponse, type NextRequest } from "next/server";
import { AppError, type Actor } from "@taiwanhub/shared";
import { appUrl } from "@/lib/config";
import {
  confirmConnection,
  createConnectCode,
  disconnect,
  listConnections,
  setDestination,
} from "./service";
/**
 * /api/v1/messaging/connections[/{channel}[/code|/confirm]] for the signed-in
 * member. Errors propagate to the main router's error handling.
 */
export async function handleMessagingRoute(
  request: NextRequest,
  rest: string[],
  actor: Actor | null,
) {
  const [section, channel, action] = rest;
  const method = request.method;
  if (section !== "connections" || rest.length > 3)
    throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
  if (method === "GET" && !channel) return ok(await listConnections(actor));
  if (method === "GET")
    throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appUrl).origin)
    throw new AppError(403, "BAD_ORIGIN", "Request origin is not allowed.");
  if (method === "POST" && action === "code")
    return ok(await createConnectCode(actor, channel), 201);
  if (method === "POST" && action === "confirm")
    return ok(await confirmConnection(actor, channel));
  if (method === "PATCH" && !action) {
    const raw = await request.text();
    if (raw.length > 1024)
      throw new AppError(413, "TOO_LARGE", "Request is too large.");
    return ok(await setDestination(actor, channel, JSON.parse(raw || "{}")));
  }
  if (method === "DELETE" && !action)
    return ok(await disconnect(actor, channel));
  throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
}
function ok(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}
