import { notFound, redirect } from "next/navigation";
import { getCopy } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { getCities, listContent } from "@/features/catalog/repository";
import { listInput } from "@taiwanhub/shared";
import { SubmissionForm } from "@/components/submission-form";
import { flags } from "@/lib/config";
export default async function SubmitPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const { kind } = await params;
  if (
    !["place", "event", "product-sighting"].includes(kind) ||
    !flags.submissions ||
    (kind === "product-sighting" && !flags.products)
  )
    notFound();
  const query = await searchParams;
  if (!(await currentActor()))
    redirect(
      "/sign-in?next=" +
        encodeURIComponent(
          "/submit/" +
            kind +
            (query.product ? "?product=" + query.product : ""),
        ),
    );
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
        />
      </div>
    </div>
  );
}
