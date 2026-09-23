"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExtractionPage } from "@taiwanhub/database";
import { api } from "./actions";
import { Field, fieldProps } from "./ui/field";

/**
 * Manages the pages the extraction adapter reads. A page starts disabled and
 * cannot be added without a permission note, so enabling one is a deliberate
 * act rather than a side effect of pasting a URL.
 */
export function ExtractionPageControls({ page }: { page: ExtractionPage }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage("");
    try {
      await run();
      router.refresh();
      setMessage(done);
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
          className={`button small${page.enabled ? " secondary" : ""}`}
          disabled={busy}
          onClick={() =>
            send(
              () =>
                api(`admin/extraction/${page.id}`, "POST", {
                  enabled: !page.enabled,
                }),
              page.enabled ? "Paused" : "Enabled",
            )
          }
        >
          {page.enabled ? "Pause" : "Enable"}
        </button>
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() =>
            send(() => api(`admin/extraction/${page.id}`, "DELETE"), "Removed")
          }
        >
          Remove
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

const blank = {
  feedSlug: "",
  kind: "places",
  sourceLabel: "",
  url: "",
  neighborhood: "",
  permissionNote: "",
};

export function AddExtractionPage({ feeds }: { feeds: string[] }) {
  const router = useRouter();
  const [form, setForm] = useState(blank);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof blank) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  return (
    <form
      className="form-stack admin-item"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          await api("admin/extraction", "POST", form);
          setForm(blank);
          router.refresh();
          setMessage("Added, paused until you enable it.");
        } catch (error) {
          setMessage((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Add a source page</h3>
      <Field
        id="extraction-url"
        label="Page URL"
        help="One public HTTPS page describing one place. The adapter does not follow links."
      >
        <input
          {...fieldProps("extraction-url", { help: true })}
          type="url"
          required
          value={form.url}
          onChange={(e) => set("url")(e.target.value)}
        />
      </Field>
      <Field
        id="extraction-feed"
        label="Feed slug"
        help={
          feeds.length
            ? `Existing feeds: ${feeds.join(", ")}`
            : "Lowercase with hyphens, e.g. houston-places."
        }
      >
        <input
          {...fieldProps("extraction-feed", { help: true })}
          required
          value={form.feedSlug}
          onChange={(e) => set("feedSlug")(e.target.value)}
        />
      </Field>
      <Field id="extraction-kind" label="Kind">
        <select
          {...fieldProps("extraction-kind", {})}
          value={form.kind}
          onChange={(e) => set("kind")(e.target.value)}
        >
          <option value="places">Places</option>
          <option value="organizations">Organizations</option>
        </select>
      </Field>
      <Field
        id="extraction-label"
        label="Source label"
        help="Shown beside collected records. Every page in a feed shares one label."
      >
        <input
          {...fieldProps("extraction-label", { help: true })}
          required
          value={form.sourceLabel}
          onChange={(e) => set("sourceLabel")(e.target.value)}
        />
      </Field>
      <Field
        id="extraction-neighborhood"
        label="Neighborhood (optional)"
        help="Used only when the page does not name one. Your assertion, so leave it blank unless you know it."
      >
        <input
          {...fieldProps("extraction-neighborhood", { help: true })}
          value={form.neighborhood}
          onChange={(e) => set("neighborhood")(e.target.value)}
        />
      </Field>
      <Field
        id="extraction-permission"
        label="Permission note"
        help="Who owns the page and why storing its facts is allowed, with the date you checked."
      >
        <textarea
          {...fieldProps("extraction-permission", { help: true })}
          required
          minLength={10}
          rows={3}
          value={form.permissionNote}
          onChange={(e) => set("permissionNote")(e.target.value)}
        />
      </Field>
      <button className="button" disabled={busy} type="submit">
        Add page
      </button>
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
