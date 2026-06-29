#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const since = new Date();
since.setUTCDate(since.getUTCDate() - 30);

const result = {};

result.ordersByPlatform = await prisma.ecommerceOrder.groupBy({
  by: ["platform"],
  where: { placedAt: { gte: since } },
  _count: { _all: true },
  _sum: { orderTotal: true },
});

result.metricsBySource = await prisma.dailyMetric.groupBy({
  by: ["source"],
  where: { date: { gte: since } },
  _count: { _all: true },
  _sum: { spend: true, conversions: true, conversionsValue: true, leads: true },
});

result.connectorsByProvider = await prisma.connectorAccount.groupBy({
  by: ["provider", "status"],
  _count: { _all: true },
});

console.log(
  JSON.stringify(
    result,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);

await prisma.$disconnect();
