import { redirect, notFound } from "next/navigation";
import { getCities } from "@/features/catalog/repository";
export default async function CityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await getCities()).some((c) => c.slug === slug)) notFound();
  redirect("/places?city=" + slug);
}
