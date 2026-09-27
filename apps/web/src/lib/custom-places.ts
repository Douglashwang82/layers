import type { CustomPlace } from "@/features/custom-places/repository";
import type { MapItem } from "@/features/map/query";
/**
 * A member-created place as a map/list item. It behaves as a place (filters,
 * icons, directions) but has no catalog page, votes or saves, and opens on the
 * map with the layer that holds it.
 */
export function customMapItem(place: CustomPlace, layerSlug: string): MapItem {
  return {
    key: place.key,
    type: "place",
    id: place.id,
    slug: place.id,
    href: `/?layers=${encodeURIComponent(layerSlug)}&item=${encodeURIComponent(place.key)}`,
    name: place.name,
    nameChinese: place.nameChinese,
    category: "",
    image: null,
    neighborhood: "",
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    locationStatus: place.locationStatus,
    isDemo: false,
    score: null,
    responses: 0,
    priceLevel: null,
    startTime: null,
    endTime: null,
    eventStatus: null,
    attending: 0,
    capacity: null,
    organizerName: null,
    authorName: null,
    publishedAt: null,
    sourceUrl: null,
    excerpt: place.note || null,
    layers: [],
    note: null,
    rank: 0,
    customScope: place.ownerKind,
  };
}
