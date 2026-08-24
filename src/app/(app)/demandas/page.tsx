import type { Metadata } from "next";

import { DemandBoard } from "@/components/demands/demand-board";
import { getDemandBoard } from "@/lib/demands/queries";

export const metadata: Metadata = {
  title: "Demandas — W3 Marketplace",
};

export default async function DemandsPage() {
  const board = await getDemandBoard();
  return <DemandBoard initialData={board} />;
}
