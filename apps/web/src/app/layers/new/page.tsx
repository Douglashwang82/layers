import { redirect } from "next/navigation";
import { flags } from "@/lib/config";
import { layerWorkspaceHref } from "@/lib/layer-workspace";
import Screen, { metadata } from "@/components/layers/screens/new";
export { metadata };
export default async function Page(props: Parameters<typeof Screen>[0]) {
  if (flags.mapHome) {
    const query = await props.searchParams;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) params.set(key, value);
    redirect(layerWorkspaceHref("/layers/new?" + params.toString()));
  }
  return <Screen {...props} />;
}
