import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const nameLike = process.argv[2] ?? "LIVE";

const rows = await prisma.dailyMetric.findMany({
  where: {
    source: "META_ADS",
    campaignName: { contains: nameLike, mode: "insensitive" },
  },
  select: {
    date: true,
    campaignId: true,
    campaignName: true,
    campaignStatus: true,
  },
  orderBy: { date: "desc" },
  take: 10,
});
console.log(`Top 10 rows matching '${nameLike}':`);
for (const r of rows) {
  console.log(
    `  ${r.date.toISOString().slice(0, 10)}  ${r.campaignName}  status=${r.campaignStatus}  id=${r.campaignId}`,
  );
}

const byStatus = await prisma.dailyMetric.groupBy({
  by: ["campaignName", "campaignStatus"],
  where: {
    source: "META_ADS",
    campaignName: { contains: nameLike, mode: "insensitive" },
  },
  _count: { _all: true },
});
console.log(`\nStatus distribution:`);
for (const r of byStatus) {
  console.log(`  ${r.campaignName} → ${r.campaignStatus}: ${r._count._all}`);
}

await prisma.$disconnect();
