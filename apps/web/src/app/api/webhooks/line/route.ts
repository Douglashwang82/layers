import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  parseLineWebhook,
  verifyLineSignature,
} from "@/features/messaging/channels";
import { channelConfig } from "@/features/messaging/outbound";
import { receiveWebhook } from "@/features/messaging/webhook";
/** LINE Messaging API webhook (docs/plans/dm-link-to-layer-design.md). */
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const line = channelConfig().line;
  if (!line) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return receiveWebhook(
    request,
    (raw) =>
      verifyLineSignature(
        raw,
        request.headers.get("x-line-signature"),
        line.channelSecret,
      ),
    parseLineWebhook,
  );
}
