import { after, NextResponse, type NextRequest } from "next/server";
import { maxWebhookBytes, type InboundEvent } from "./channels";
import { chatCaptureEnabled, handleEvents } from "./service";
/*
 * Shared webhook handling: read the raw body under a size cap, verify the
 * platform signature over exactly those bytes, parse, acknowledge with 200
 * at once, and process after the response (LINE reply tokens and Meta
 * delivery both expect a fast acknowledgement). Redelivery is idempotent
 * through messaging_receipt.
 */
export async function receiveWebhook(
  request: NextRequest,
  verify: (raw: string) => boolean,
  parse: (body: unknown) => InboundEvent[],
) {
  if (!chatCaptureEnabled())
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (Number(request.headers.get("content-length") ?? 0) > maxWebhookBytes)
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxWebhookBytes)
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  if (!verify(raw))
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  let events: InboundEvent[];
  try {
    events = parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (events.length) after(() => handleEvents(events));
  return NextResponse.json({ ok: true });
}
