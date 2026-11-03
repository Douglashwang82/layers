import type { Copy } from "@/lib/dictionary";

/** Maps URLs need no Places request or API key. */
export function GoogleMapsLink({
  placeId,
  name,
  t,
}: {
  placeId: string;
  name?: string | null;
  t: Copy;
}) {
  const params = new URLSearchParams({
    api: "1",
    query: name || placeId,
    query_place_id: placeId,
  });
  return (
    <a
      className="text-button"
      href={`https://www.google.com/maps/search/?${params}`}
      target="_blank"
      rel="noreferrer"
    >
      {t.routeOpen}
    </a>
  );
}
