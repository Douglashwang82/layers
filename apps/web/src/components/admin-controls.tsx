"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Copy } from "@/lib/i18n";
import type { Content } from "@/features/catalog/repository";
import { api } from "./actions";
export function IngestionControls({
  id,
  disabled,
}: {
  id: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    try {
      await api(`admin/ingestion/${id}`, "POST", { decision });
      router.refresh();
      setMessage(decision === "approve" ? "Published" : "Rejected");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="actions">
        <button
          className="button small"
          disabled={busy || disabled}
          onClick={() => decide("approve")}
        >
          Approve and publish
        </button>
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() => decide("reject")}
        >
          Reject
        </button>
      </div>
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
export function RevisionControls({ id }: { id: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button
        className="button secondary small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`admin/revisions/${id}`, "POST");
            router.refresh();
            setMessage("Reverted");
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Revert this update
      </button>
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
export function ModerateControls({
  entityType,
  entityId,
  t,
  admin,
}: {
  entityType: string;
  entityId: string;
  t: Copy;
  admin: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <label>
        {t.reason}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          required
        />
      </label>
      <div className="actions">
        {(
          [
            "approved",
            "rejected",
            "hidden",
            ...(admin ? ["deleted"] : []),
          ] as const
        ).map((action) => (
          <button
            key={action}
            disabled={!reason.trim() || busy}
            className="button secondary small"
            onClick={async () => {
              setBusy(true);
              try {
                await api("admin", "POST", {
                  entityType,
                  entityId,
                  action,
                  reason,
                });
                router.refresh();
                setMessage(action);
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {action === "approved"
              ? t.approve
              : action === "rejected"
                ? t.reject
                : action === "hidden"
                  ? t.hide
                  : t.remove}
          </button>
        ))}
      </div>
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
export function EditContentForm({
  item,
  kind,
  t,
}: {
  item: Content;
  kind: string;
  t: Copy;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        className="text-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t.edit}
      </button>
      {open && (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const fields: Record<string, unknown> = Object.fromEntries(
                new FormData(e.currentTarget),
              );
              if (kind === "events") {
                fields.startTime = new Date(
                  String(fields.startTime),
                ).toISOString();
                fields.endTime = new Date(String(fields.endTime)).toISOString();
                fields.capacity = fields.capacity
                  ? Number(fields.capacity)
                  : null;
              }
              await api(`admin/${kind}/${item.id}`, "PATCH", fields);
              setOpen(false);
              router.refresh();
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          <label>
            {t.title}
            <input name="name" defaultValue={item.name} required />
          </label>
          <label>
            {t.chineseName}
            <input name="nameChinese" defaultValue={item.nameChinese} />
          </label>
          <label>
            {t.description}
            <textarea
              name="description"
              defaultValue={item.description}
              required
            />
          </label>
          <label>
            {t.image}
            <input name="image" defaultValue={item.image} required />
          </label>
          <label>
            {t.category}
            <input name="category" defaultValue={item.category} required />
          </label>
          <label>
            {t.description} (繁體中文)
            <textarea
              name="descriptionChinese"
              defaultValue={item.descriptionChinese}
            />
          </label>
          <label>
            {t.search}
            <input name="aliases" defaultValue={item.aliases ?? ""} />
          </label>
          {(kind === "places" || kind === "events") && (
            <>
              <label>
                {t.address}
                <input name="address" defaultValue={item.address} required />
              </label>
              <label>
                {t.neighborhood}
                <input
                  name="neighborhood"
                  defaultValue={item.neighborhood}
                  required
                />
              </label>
              <div className="form-row">
                <label>
                  {t.latitude}
                  <input
                    name="latitude"
                    type="number"
                    step="any"
                    defaultValue={item.latitude}
                    required
                  />
                </label>
                <label>
                  {t.longitude}
                  <input
                    name="longitude"
                    type="number"
                    step="any"
                    defaultValue={item.longitude}
                    required
                  />
                </label>
              </div>
            </>
          )}
          {kind === "places" && (
            <>
              <label>
                {t.hours}
                <input name="hours" defaultValue={item.hours ?? ""} />
              </label>
              <label>
                {t.phone}
                <input name="phone" defaultValue={item.phone ?? ""} />
              </label>
            </>
          )}
          {(kind === "places" || kind === "organizations") && (
            <label>
              {t.website}
              <input
                name="website"
                type="url"
                defaultValue={item.website ?? ""}
              />
            </label>
          )}
          {kind === "events" && (
            <>
              <label>
                {t.venue}
                <input name="venue" defaultValue={item.venue} required />
              </label>
              <label>
                {t.start} (ISO UTC)
                <input
                  name="startTime"
                  defaultValue={item.startTime}
                  required
                />
              </label>
              <label>
                {t.end} (ISO UTC)
                <input name="endTime" defaultValue={item.endTime} required />
              </label>
              <label>
                {t.capacity}
                <input
                  name="capacity"
                  type="number"
                  min="1"
                  defaultValue={item.capacity ?? ""}
                />
              </label>
            </>
          )}
          {kind === "products" && (
            <>
              <label>
                {t.brand}
                <input name="brand" defaultValue={item.brand} required />
              </label>
              <label>
                {t.online}
                <input
                  name="onlineUrl"
                  type="url"
                  defaultValue={item.onlineUrl ?? ""}
                />
              </label>
            </>
          )}
          {kind === "organizations" && (
            <>
              <label>
                Instagram
                <input
                  name="instagram"
                  type="url"
                  defaultValue={item.instagram ?? ""}
                />
              </label>
              <label>
                Facebook
                <input
                  name="facebook"
                  type="url"
                  defaultValue={item.facebook ?? ""}
                />
              </label>
            </>
          )}
          <button className="button">{t.saveChanges}</button>
          {message && (
            <p className="message error-message" role="alert">
              {message}
            </p>
          )}
        </form>
      )}
    </>
  );
}
