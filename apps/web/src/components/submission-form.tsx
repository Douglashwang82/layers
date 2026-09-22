"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  placeCategories,
  eventCategories,
  type SubmissionFields,
} from "@taiwanhub/shared";
import type { Copy } from "@/lib/i18n";
import { api, StatusMessage } from "./actions";
import { Field, fieldProps } from "./ui/field";
type Values = SubmissionFields;
type Option = { id: string; name: string };
type Upload =
  | { state: "idle" }
  | { state: "uploading" }
  | { state: "done"; url: string }
  | { state: "failed"; message: string };
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
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [done, setDone] = useState(false);
  const [upload, setUpload] = useState<Upload>({ state: "idle" });
  const {
    register,
    setValue,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<Values>({
    defaultValues: {
      cityId: cities[0]?.id,
      productId,
      observedAt: new Date().toISOString().slice(0, 10),
      latitude: "29.7604",
      longitude: "-95.3698",
    },
  });
  const errorOf = (key: keyof Values) =>
    (errors[key]?.message as string | undefined) ?? undefined;
  const field = (
    key: keyof Values,
    label: string,
    type = "text",
    required = true,
    help?: string,
  ) => (
    <Field id={`f-${key}`} label={label} help={help} error={errorOf(key)}>
      <input
        type={type}
        {...register(key)}
        {...fieldProps(`f-${key}`, { help: !!help, error: errorOf(key) })}
        required={required}
        step={type === "number" ? "any" : undefined}
      />
    </Field>
  );
  const select = (key: keyof Values, label: string, options: Option[]) => (
    <Field id={`f-${key}`} label={label} error={errorOf(key)}>
      <select
        {...register(key)}
        {...fieldProps(`f-${key}`, { error: errorOf(key) })}
        required
      >
        <option value="">{t.choose}</option>
        {options.map((o) => (
          <option value={o.id} key={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </Field>
  );
  const busy = isSubmitting || upload.state === "uploading";
  return (
    <form
      className="form-stack"
      onSubmit={handleSubmit(async (data) => {
        setFeedback(null);
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
          setFeedback({ tone: "success", text: t.pending });
        } catch (e) {
          // Values stay in the form so the person can correct and resubmit.
          setFeedback({ tone: "error", text: (e as Error).message });
        }
      })}
    >
      {kind === "product-sighting" ? (
        <fieldset className="form-group">
          <legend>{t.basics}</legend>
          {select("productId", t.product, products)}
          {select("placeId", t.store, stores)}
          {field("observedAt", t.observed, "date")}
          {field("price", t.price, "number", false)}
        </fieldset>
      ) : (
        <>
          <fieldset className="form-group">
            <legend>{t.basics}</legend>
            {field("name", t.title)}
            {field("nameChinese", t.chineseName, "text", false)}
            <Field
              id="f-description"
              label={t.description}
              error={errorOf("description")}
            >
              <textarea
                {...register("description")}
                {...fieldProps("f-description", {
                  error: errorOf("description"),
                })}
                required
                maxLength={2000}
                rows={4}
              />
            </Field>
            {select(
              "category",
              t.category,
              (kind === "event" ? eventCategories : placeCategories).map(
                (name) => ({ id: name, name }),
              ),
            )}
            {kind === "event" &&
              select("organizerId", t.organizer, organizations)}
          </fieldset>
          <fieldset className="form-group">
            <legend>{t.locationTime}</legend>
            {select("cityId", t.city, cities)}
            {kind === "event" && field("venue", t.venue)}
            {field("neighborhood", t.neighborhood)}
            {field("address", t.address)}
            <div className="form-row">
              {field("latitude", t.latitude, "number")}
              {field("longitude", t.longitude, "number")}
            </div>
            {kind === "event" && (
              <>
                <div className="form-row">
                  {field("startTime", t.start, "datetime-local")}
                  {field("endTime", t.end, "datetime-local")}
                </div>
                <p className="fine-print">
                  {t.timeNote} (
                  {Intl.DateTimeFormat().resolvedOptions().timeZone})
                </p>
              </>
            )}
          </fieldset>
        </>
      )}
      <fieldset className="form-group">
        <legend>{t.optionalDetails}</legend>
        {kind === "event" && field("capacity", t.capacity, "number", false)}
        {field("image", t.image, "url", false)}
        <Field
          id="f-upload"
          label={t.upload}
          help={
            upload.state === "uploading"
              ? t.uploading
              : upload.state === "done"
                ? t.uploaded
                : upload.state === "failed"
                  ? upload.message
                  : undefined
          }
        >
          <input
            id="f-upload"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={upload.state === "uploading"}
            aria-busy={upload.state === "uploading" || undefined}
            aria-invalid={upload.state === "failed" ? true : undefined}
            aria-describedby={
              upload.state === "idle" ? undefined : "f-upload-help"
            }
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUpload({ state: "uploading" });
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
                setUpload({ state: "done", url: result.data.url });
              } catch (e) {
                setUpload({
                  state: "failed",
                  message: (e as Error).message || t.uploadFailed,
                });
              }
            }}
          />
        </Field>
      </fieldset>
      <div className="actions">
        <button
          className="button"
          disabled={busy || done}
          aria-busy={isSubmitting || undefined}
        >
          {isSubmitting ? t.submitting : t.submit}
        </button>
      </div>
      <StatusMessage feedback={feedback} />
    </form>
  );
}
