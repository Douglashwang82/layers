import { z } from "zod";
export const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => !/[<>\u0000-\u0008]/.test(v),
      "Use plain text without markup.",
    );
