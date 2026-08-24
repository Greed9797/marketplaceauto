import { NextResponse } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const LIST_LIMIT = 50;

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export async function GET() {
  const context = await getCurrentUserContext();
  const workspaceId = context.currentMembership.workspaceId;

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
    }),
    prisma.notification.count({
      where: { workspaceId, readAt: null },
    }),
  ]);

  // Críticos primeiro, depois warning, depois info; recência dentro do grupo.
  const notifications = [...rows].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );

  return NextResponse.json({ notifications, unreadCount });
}
