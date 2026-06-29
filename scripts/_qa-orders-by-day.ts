import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const cid = process.argv[2];
if (!cid) {
  console.error("usage: tsx _qa-orders-by-day.ts <connectorAccountId>");
  process.exit(1);
}

const orders = await prisma.ecommerceOrder.findMany({
  where: { connectorAccountId: cid },
  select: { placedAt: true, orderTotal: true },
  orderBy: { placedAt: "asc" },
});

console.log(`Total orders: ${orders.length}`);
const byDayUtc = new Map<string, { count: number; total: number }>();
for (const o of orders) {
  const key = o.placedAt.toISOString().slice(0, 10);
  const cur = byDayUtc.get(key) ?? { count: 0, total: 0 };
  cur.count += 1;
  cur.total += Number(o.orderTotal);
  byDayUtc.set(key, cur);
}
const days = Array.from(byDayUtc.entries()).sort();
console.log(`\nDay-by-day (UTC):`);
for (const [k, v] of days) {
  console.log(`  ${k}  count=${v.count}  total=R$${v.total.toFixed(2)}`);
}

await prisma.$disconnect();
