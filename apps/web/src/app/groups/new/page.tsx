import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCopy } from "@/lib/i18n";
import { getActiveCity } from "@/lib/city";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import { CreateGroupForm } from "@/components/groups/group-management";
export const metadata: Metadata = {
  title: "Create group",
  robots: { index: false },
};
export default async function NewGroupPage() {
  const actor = await currentActor();
  if (!flags.layerWrites) redirect("/layers?tab=groups");
  if (!actor) redirect("/sign-in?next=/groups/new");
  const [t, { city }] = await Promise.all([getCopy(), getActiveCity()]);
  return (
    <div className="container">
      <CreateGroupForm city={city} t={t} />
    </div>
  );
}
