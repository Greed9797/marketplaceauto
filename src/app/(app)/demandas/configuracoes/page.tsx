import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DemandSettings } from "@/components/demands/demand-settings";
import { getDemandBoard } from "@/lib/demands/queries";

export const metadata: Metadata = {
  title: "Configurar demandas — W3 Marketplace",
};

export default async function DemandSettingsPage() {
  const board = await getDemandBoard();
  if (!board.canManage) redirect("/demandas");
  return <DemandSettings initialData={board} />;
}
