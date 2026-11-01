import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  parseInstagramWebhook,
  verifyMetaSignature,
} from "@/features/messaging/channels";
import { channelConfig } from "@/features/messaging/outbound";
import { chatCaptureEnabled } from "@/features/messaging/service";
import { receiveWebhook } from "@/features/messaging/webhook";
import { timingSafeEqual } from "node:crypto";
/** Instagram messaging webhook (Instagram API with Instagram Login). */
export const maxDuration = 60;
/** Subscription handshake: echo hub.challenge when the verify token matches. */
export async function GET(request: NextRequest) {
  const ig = channelConfig().instagram;
  if (!ig || !chatCaptureEnabled())
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const params = request.nextUrl.searchParams;
  const token = Buffer.from(params.get("hub.verify_token") ?? "");
  const expected = Buffer.from(ig.verifyToken);
  const challenge = params.get("hub.challenge") ?? "";
  if (
    params.get("hub.mode") !== "subscribe" ||
    token.length !== expected.length ||
    !timingSafeEqual(token, expected) ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(challenge)
  )
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return new NextResponse(challenge, {
    headers: { "Content-Type": "text/plain" },
  });
}
export async function POST(request: NextRequest) {
  const ig = channelConfig().instagram;
  if (!ig) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return receiveWebhook(
    request,
    (raw) =>
      verifyMetaSignature(
        raw,
        request.headers.get("x-hub-signature-256"),
        ig.appSecret,
      ),
    parseInstagramWebhook,
  );
}
