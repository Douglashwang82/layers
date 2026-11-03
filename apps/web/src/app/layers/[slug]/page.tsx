import { redirect } from "next/navigation";
import { flags } from "@/lib/config";
import { layerWorkspaceHref } from "@/lib/layer-workspace";
import Screen, { generateMetadata } from "@/components/layers/screens/detail";
export { generateMetadata };
export default async function Page(props: {
  params: Promise<{ slug: string }>;
}) {
  if (flags.mapHome) {
    const { slug } = await props.params;
    redirect(layerWorkspaceHref(`/layers/${encodeURIComponent(slug)}`));
  }
  return <Screen {...props} />;
}
