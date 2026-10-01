import type { Metadata } from "next";
import { MascotStudio } from "@/components/mascot/mascot-studio";
import { getCopy } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Warm Pin V2",
  robots: { index: false, follow: false },
};

export default async function MascotPage() {
  return <MascotStudio t={await getCopy()} />;
}
