import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCities } from "@/features/catalog/repository";
import { trackEvent } from "@/lib/analytics";
import { appUrl } from "@/lib/config";
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(appUrl).origin)
    return NextResponse.json(
      { error: { message: "Invalid origin." } },
      { status: 403 },
    );
  const parsed = z
    .object({ city: z.string().max(80) })
    .safeParse(await req.json().catch(() => null));
  if (
    !parsed.success ||
    !(await getCities()).some((c) => c.slug === parsed.data.city)
  )
    return NextResponse.json(
      { error: { message: "Choose a supported city." } },
      { status: 400 },
    );
  const response = NextResponse.json({ data: parsed.data });
  response.cookies.set("city", parsed.data.city, {
    path: "/",
    sameSite: "lax",
    maxAge: 31536000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  await trackEvent("city_changed", { city: parsed.data.city });
  return response;
}
