import { notFound, redirect } from "next/navigation";
import { getCopy } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import {
  getCities,
  listContent,
  listNames,
} from "@/features/catalog/repository";
import { listInput } from "@taiwanhub/shared";
import { SubmissionForm } from "@/components/submission-form";
import { ContentForm } from "@/components/content/content-form";
import { getActiveCity } from "@/lib/city";
import { flags } from "@/lib/config";
export default async function SubmitPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ product?: string; name?: string }>;
}) {
  const { kind } = await params;
  if (
    !["place", "event", "product-sighting", "content"].includes(kind) ||
    !flags.submissions ||
    (kind === "product-sighting" && !flags.products) ||
    (kind === "content" && !flags.content)
  )
    notFound();
  const query = await searchParams;
  // Prefill only: the form still validates the submitted name.
  const initialName =
    typeof query.name === "string" ? query.name.trim().slice(0, 120) : "";
  if (!(await currentActor())) {
    const next = new URLSearchParams();
    if (query.product) next.set("product", query.product);
    if (initialName) next.set("name", initialName);
    const search = next.toString();
    redirect(
      "/sign-in?next=" +
        encodeURIComponent("/submit/" + kind + (search ? "?" + search : "")),
    );
  }
  if (kind === "content") {
    const [t, { city }] = await Promise.all([getCopy(), getActiveCity()]);
    const [places, events] = await Promise.all([
      listNames("places", city.slug),
      listNames("events", city.slug),
    ]);
    return (
      <div className="container">
        <div className="form-panel">
          <span className="eyebrow">{t.submissions}</span>
          <h1>{t.shareTip}</h1>
          <p>{t.contentIntro}</p>
          <ContentForm t={t} city={city} places={places} events={events} />
        </div>
      </div>
    );
  }
  const [t, cities, orgs, products, stores] = await Promise.all([
    getCopy(),
    getCities(),
    listContent("organizations", listInput.parse({})),
    listContent("products", listInput.parse({})),
    listContent("places", listInput.parse({ category: "Asian Grocery" })),
  ]);
  return (
    <div className="container">
      <div className="form-panel">
        <span className="eyebrow">{t.submissions}</span>
        <h1>
          {kind === "place"
            ? t.submitPlace
            : kind === "event"
              ? t.submitEvent
              : t.found}
        </h1>
        <p>{kind === "product-sighting" ? t.inventory : t.notesPending}</p>
        <SubmissionForm
          kind={kind as "place" | "event" | "product-sighting"}
          {...{ t, cities }}
          organizations={orgs.items}
          products={products.items}
          stores={stores.items}
          productId={query.product}
          initialName={initialName}
        />
      </div>
    </div>
  );
}
