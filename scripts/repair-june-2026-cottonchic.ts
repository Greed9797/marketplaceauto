// Reparo one-time: re-backfill junho/2026 da Cotton Chic (NuvemShop).
// Usa a própria máquina de sync (upsert idempotente + recompute DailyMetric).
// Rodar com DATABASE_URL apontando pro schema w3ads (prod):
//   DATABASE_URL="postgres://...?schema=w3ads" npx tsx scripts/repair-june-2026-cottonchic.ts
import { syncEcommerceOrders } from "@/lib/connectors/ecommerce-sync";

const CONNECTOR_ID = "cmq5nebrk00059mb9pll12ln4"; // Nuvemshop 5077392 / Cotton Chic

const result = await syncEcommerceOrders({
  connectorAccountId: CONNECTOR_ID,
  range: { since: "2026-06-01", until: "2026-06-30" },
  syncType: "BACKFILL",
});

console.log(
  `repair done: complete=${result.complete} ordersCount=${result.ordersCount}`,
);
process.exit(0);
