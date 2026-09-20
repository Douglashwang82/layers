"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  placeCategories,
  eventCategories,
  type SubmissionFields,
} from "@taiwanhub/shared";
import type { Copy } from "@/lib/i18n";
import { api } from "./actions";
type Values = SubmissionFields;
type Option = { id: string; name: string };
export function SubmissionForm({
  kind,
  t,
  cities,
  organizations,
  products,
  stores,
  productId,
}: {
  kind: "place" | "event" | "product-sighting";
  t: Copy;
  cities: Option[];
  organizations: Option[];
  products: Option[];
  stores: Option[];
  productId?: string;
}) {
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [uploading, setUploading] = useState(false);
  const {
    register,
    setValue,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<Values>({
    defaultValues: {
      cityId: cities[0]?.id,
      productId,
      observedAt: new Date().toISOString().slice(0, 10),
      latitude: "29.7604",
      longitude: "-95.3698",
    },
  });
  const field = (
    key: keyof Values,
    label: string,
    type = "text",
    required = true,
  ) => (
    <label>
      {label}
      <input
        type={type}
        {...register(key)}
        required={required}
        step={type === "number" ? "any" : undefined}
      />
    </label>
  );
  const select = (key: keyof Values, label: string, options: Option[]) => (
    <label>
      {label}
      <select aria-label={label} {...register(key)} required>
        <option value="">{t.choose}</option>
        {options.map((o) => (
          <option value={o.id} key={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form
      className="form-stack"
      onSubmit={handleSubmit(async (data) => {
        setMessage("");
        try {
          if (kind === "product-sighting")
            await api("product-sightings", "POST", {
              productId: data.productId,
              placeId: data.placeId,
              observedAt: new Date(
                data.observedAt + "T00:00:00Z",
              ).toISOString(),
              ...(data.price ? { price: Number(data.price) } : {}),
              ...(data.image ? { image: data.image } : {}),
            });
          else {
            const base = {
              name: data.name,
              nameChinese: data.nameChinese,
              description: data.description,
              cityId: data.cityId,
              neighborhood: data.neighborhood,
              address: data.address,
              latitude: Number(data.latitude),
              longitude: Number(data.longitude),
              category: data.category,
              ...(data.image ? { image: data.image } : {}),
            };
            await api(
              kind === "event" ? "events" : "places",
              "POST",
              kind === "event"
                ? {
                    ...base,
                    organizerId: data.organizerId,
                    venue: data.venue,
                    startTime: new Date(data.startTime!).toISOString(),
                    endTime: new Date(data.endTime!).toISOString(),
                    ...(data.capacity
                      ? { capacity: Number(data.capacity) }
                      : {}),
                  }
                : base,
            );
          }
          setDone(true);
          setMessage(t.pending);
        } catch (e) {
          setMessage((e as Error).message);
        }
      })}
    >
      {kind === "product-sighting" ? (
        <>
          {select("productId", t.product, products)}
          {select("placeId", t.store, stores)}
          {field("price", t.price, "number", false)}
          {field("observedAt", t.observed, "date")}
        </>
      ) : (
        <>
          {field("name", t.title)}
          {field("nameChinese", t.chineseName, "text", false)}
          <label>
            {t.description}
            <textarea {...register("description")} required maxLength={2000} />
          </label>
          {select("cityId", t.city, cities)}
          {select(
            "category",
            t.category,
            (kind === "event" ? eventCategories : placeCategories).map(
              (name) => ({ id: name, name }),
            ),
          )}
          {field("neighborhood", t.neighborhood)}
          {field("address", t.address)}
          <div className="form-row">
            {field("latitude", t.latitude, "number")}
            {field("longitude", t.longitude, "number")}
          </div>
          {kind === "event" && (
            <>
              {select("organizerId", t.organizer, organizations)}
              {field("venue", t.venue)}
              <div className="form-row">
                {field("startTime", t.start, "datetime-local")}
                {field("endTime", t.end, "datetime-local")}
              </div>
              <p className="fine-print">
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </p>
              {field("capacity", t.capacity, "number", false)}
            </>
          )}
        </>
      )}
      {field("image", t.image, "text", false)}
      <label>
        {t.upload}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true);
            const form = new FormData();
            form.append("image", file);
            try {
              const response = await fetch("/api/v1/images", {
                method: "POST",
                body: form,
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error.message);
              setValue("image", result.data.url);
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setUploading(false);
            }
          }}
        />
      </label>
      <button className="button" disabled={isSubmitting || uploading || done}>
        {t.submit}
      </button>
      <p role="status" className={`message ${done ? "" : "error-message"}`}>
        {message}
      </p>
    </form>
  );
}
