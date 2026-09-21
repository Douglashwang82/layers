import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@taiwanhub/database";
import { eq } from "drizzle-orm";
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const [row] = await db
    .select({ payload: schema.generatedFeed.payload })
    .from(schema.generatedFeed)
    .where(eq(schema.generatedFeed.slug, slug))
    .limit(1);
  if (!row)
    return NextResponse.json({ error: { message: "Unknown feed." } }, {
      status: 404,
    });
  return NextResponse.json(row.payload, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
