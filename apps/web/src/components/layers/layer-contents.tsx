"use client";
import { useRouter } from "next/navigation";
import type { MapItem } from "@/features/map/query";
import type { Copy, Locale } from "@/lib/dictionary";
import { ResultRow } from "@/components/map/map-results";
/** Read-only contents list; selecting a row opens it on the map with this layer applied alone. */
export function LayerContentsList({
  items,
  slug,
  t,
  locale,
}: {
  items: MapItem[];
  slug: string;
  t: Copy;
  locale: Locale;
}) {
  const router = useRouter();
  return (
    <ul className="layer-contents">
      {items.map((item) => (
        <ResultRow
          key={item.key}
          item={item}
          t={t}
          locale={locale}
          selected={false}
          onSelect={(key) =>
            router.push(`/?layers=${slug}&item=${encodeURIComponent(key)}`)
          }
        />
      ))}
    </ul>
  );
}
