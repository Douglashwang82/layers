import Library from "./screens/library";
import Detail from "./screens/detail";
import NewLayer from "./screens/new";
import EditLayer from "./screens/edit";
import { readLayerPanel } from "@/lib/layer-workspace";

export function LayerWorkspaceScreen({
  params,
}: {
  params: Record<string, string | undefined>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) query.set(key, value);
  const panel = readLayerPanel(query);
  if (!panel) return null;
  if (panel === "new")
    return <NewLayer searchParams={Promise.resolve(params)} />;
  if (panel === "library" || !params.layer)
    return (
      <Library
        searchParams={Promise.resolve({
          city: params.city,
          tab: params.layerTab,
          q: params.layerQ,
        })}
      />
    );
  const slug = Promise.resolve({ slug: params.layer });
  if (panel === "detail") return <Detail params={slug} />;
  return <EditLayer params={slug} section={panel} />;
}
