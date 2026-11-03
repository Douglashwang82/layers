"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Copy, Locale } from "@/lib/dictionary";
import { getPlacesProvider } from "@/lib/places/provider";
import { subjectApi } from "@/lib/places/api";
import { BusinessPanel, type PlaceFlags } from "./business-panel";
import { RequestedProviderDetails } from "./requested-provider-details";
/** Client shell for /place-subjects/{id}: the provider is created only in the browser. */
export function SubjectPage({
  subjectId,
  placeId,
  providerKey,
  authenticated,
  flags,
  t,
  locale,
}: {
  subjectId: string;
  placeId: string | null;
  providerKey: string | null;
  authenticated: boolean;
  flags: PlaceFlags;
  t: Copy;
  locale: Locale;
}) {
  const provider = useMemo(
    () => getPlacesProvider(providerKey ?? undefined, locale),
    [providerKey, locale],
  );
  return (
    <BusinessPanel
      provider={provider}
      placeId={placeId}
      subjectId={subjectId}
      temporary={false}
      authenticated={authenticated}
      flags={flags}
      t={t}
      locale={locale}
    />
  );
}
/**
 * Owner-only saved businesses. Each provider card requires explicit intent;
 * unavailable places stay removable.
 */
export function SavedExternalList({
  items,
  providerKey,
  t,
  locale,
}: {
  items: {
    subjectId: string;
    providerPlaceId: string | null;
    available: boolean;
  }[];
  providerKey: string | null;
  t: Copy;
  locale: Locale;
}) {
  const router = useRouter();
  const provider = useMemo(
    () => getPlacesProvider(providerKey ?? undefined, locale),
    [providerKey, locale],
  );
  const [settled, setSettled] = useState<Record<string, boolean>>({});
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <ul className="saved-external">
      {items.map((item) => (
        <li key={item.subjectId}>
          {provider && item.available && item.providerPlaceId ? (
            <RequestedProviderDetails
              t={t}
              provider={provider}
              placeId={item.providerPlaceId}
              compact
              preview
              onLoad={() =>
                setSettled((s) => ({ ...s, [item.subjectId]: true }))
              }
              onError={() =>
                setSettled((s) => ({ ...s, [item.subjectId]: false }))
              }
            />
          ) : null}
          {(!provider ||
            !item.available ||
            settled[item.subjectId] === false) && (
            <p className="fine-print">{t.externalUnavailable}</p>
          )}
          <div className="actions">
            {item.available && (
              <a
                className="text-button"
                href={`/place-subjects/${item.subjectId}`}
              >
                {t.openPlacePage}
              </a>
            )}
            <button
              type="button"
              className="button secondary small"
              disabled={removing !== null}
              onClick={async () => {
                setRemoving(item.subjectId);
                try {
                  await subjectApi(
                    `place-subjects/${item.subjectId}/save`,
                    "DELETE",
                    {},
                  );
                  router.refresh();
                } finally {
                  setRemoving(null);
                }
              }}
            >
              {removing === item.subjectId ? t.saving : t.removeSaved}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
