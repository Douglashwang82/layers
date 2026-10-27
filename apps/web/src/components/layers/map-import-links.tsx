import Link from "next/link";
import type { Locale } from "@/lib/dictionary";
import { mapImportEn, mapImportZh } from "@/lib/map-import-copy";
export function MapImportLinks({
  locale,
  layerId,
}: {
  locale: Locale;
  layerId?: string;
}) {
  const t = locale === "zh-TW" ? mapImportZh : mapImportEn;
  return (
    <p>
      <Link href={layerId ? `/map-import?layer=${layerId}` : "/map-import"}>
        {t.title}
      </Link>{" "}
      · <Link href="/layer-collections">{t.collections}</Link>
    </p>
  );
}
