import { redirect, notFound } from "next/navigation";
import { getCities } from "@/features/catalog/repository";
/** Validate the city, then open the map with that city selected. */
export default async function CityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await getCities()).some((c) => c.slug === slug)) notFound();
  redirect("/?city=" + slug);
}
