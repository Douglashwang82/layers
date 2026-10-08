export type PetTarget = { key: string; lng: number; lat: number };

type CatalogPoint = {
  key: string;
  longitude: number | null;
  latitude: number | null;
};
type ExtraPoint = { key: string; lng: number; lat: number };

/** Only already-authorized, currently displayed points may carry a mascot. */
export function selectedPetTarget(
  items: readonly CatalogPoint[],
  extras: readonly ExtraPoint[],
  selectedKey: string | null,
  extraSelectedKey: string | null,
): PetTarget | null {
  const extra = extraSelectedKey
    ? extras.find((p) => p.key === extraSelectedKey)
    : null;
  const item =
    !extraSelectedKey && selectedKey
      ? items.find((p) => p.key === selectedKey)
      : null;
  const point =
    extra ??
    (item ? { key: item.key, lng: item.longitude, lat: item.latitude } : null);
  if (
    !point ||
    point.lng == null ||
    point.lat == null ||
    !Number.isFinite(point.lng) ||
    !Number.isFinite(point.lat) ||
    Math.abs(point.lng) > 180 ||
    Math.abs(point.lat) > 90
  )
    return null;
  return { key: point.key, lng: point.lng, lat: point.lat };
}
