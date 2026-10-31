"use client";
import { useState, type ComponentProps } from "react";
import type { Copy } from "@/lib/dictionary";
import { ProviderDetails } from "./provider-slot";
import { GoogleMapsLink } from "./google-maps-link";

/** No provider mount until the user explicitly asks for this place's details. */
export function RequestedProviderDetails(
  props: ComponentProps<typeof ProviderDetails> & { t: Copy },
) {
  const [requested, setRequested] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedPlace, setLoadedPlace] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  return (
    <>
      <GoogleMapsLink placeId={props.placeId} t={props.t} />
      {requested === props.placeId &&
        !failed &&
        loadedPlace !== props.placeId && (
          <p className="fine-print" role="status">
            {props.t.businessLoading}
          </p>
        )}
      {requested === props.placeId && !failed ? (
        <ProviderDetails
          {...props}
          key={`${props.placeId}:${attempt}`}
          onLoad={(place) => {
            setLoadedPlace(props.placeId);
            props.onLoad(place);
          }}
          onError={() => {
            setFailed(true);
            props.onError();
          }}
        />
      ) : (
        <button
          type="button"
          className="button secondary small"
          onClick={() => {
            setRequested(props.placeId);
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          {failed ? props.t.retry : props.t.loadGoogleDetails}
        </button>
      )}
    </>
  );
}
