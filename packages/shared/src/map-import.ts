import { z } from "zod";

export const maxImportBytes = 5 * 1024 * 1024;
export const importPoint = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000),
  address: z.string().max(300),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
export const importDocument = z
  .object({
    title: z.string().min(1).max(80),
    sourceUrl: z.string().max(300).default(""),
    layers: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          name: z.string().min(1).max(80),
          points: z.array(importPoint).max(1000),
        }),
      )
      .min(1)
      .max(100),
    skipped: z.number().int().min(0),
  })
  .refine(
    (v) => v.layers.reduce((n, l) => n + l.points.length, 0) <= 1000,
    "Import at most 1,000 markers at a time.",
  );
export type ImportDocument = z.infer<typeof importDocument>;
/**
 * A map split into categories (My Maps layers) imports as a folder with one
 * layer per category; anything else fits in one layer. Folders whose markers
 * were all skipped don't count.
 */
export function defaultImportMode(
  document: ImportDocument,
): "new" | "collection" {
  const categories = document.layers.filter((l) => l.points.length).length;
  return categories > 1 ? "collection" : "new";
}
export const importRequest = z
  .object({
    permission: z.literal(true),
    requestId: z.uuid(),
    document: importDocument,
    selected: z.array(z.string().max(100)).min(1).max(1000),
    mode: z.enum(["existing", "new", "collection"]),
    title: z.string().trim().min(1).max(80),
    city: z.string().min(1).max(80),
    layerId: z.uuid().optional(),
    revision: z.number().int().positive().optional(),
    groupId: z.uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "existing" && (!v.layerId || !v.revision))
      ctx.addIssue({
        code: "custom",
        message: "Choose an existing layer and its current revision.",
      });
    const ids = v.document.layers.flatMap((l) => l.points.map((p) => p.id));
    if (
      new Set(ids).size !== ids.length ||
      new Set(v.document.layers.map((l) => l.id)).size !==
        v.document.layers.length ||
      v.selected.some((id) => !ids.includes(id))
    )
      ctx.addIssue({ code: "custom", message: "Invalid marker selection." });
  });
