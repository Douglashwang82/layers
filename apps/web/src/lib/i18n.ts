import { cookies } from "next/headers";
import { en, zh, type Locale } from "./dictionary";
export * from "./dictionary";
export async function getLocale(): Promise<Locale> {
  return (await cookies()).get("locale")?.value === "zh-TW" ? "zh-TW" : "en";
}
export async function getCopy() {
  return (await getLocale()) === "zh-TW" ? zh : en;
}
