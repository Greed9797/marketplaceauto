import type { Metadata } from "next";

import { KitsClient } from "./kits-client";

export const metadata: Metadata = {
  title: "Gerador de kits — W3 Marketplace",
};

export default function KitsPage() {
  return <KitsClient />;
}
