import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUserContext } from "@/lib/auth/current";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const markReadSchema = z.object({
  ids: z.array(z.string().min(1)).max(100).optional(),
  all: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const context = await getCurrentUserContext();
  const workspaceId = context.currentMembership.workspaceId;

  const body = markReadSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { success: false, error: "invalid-payload" },
      { status: 400 },
    );
  }

  if (body.data.all) {
    const result = await prisma.notification.updateMany({
      where: { workspaceId, readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ success: true, updated: result.count });
  }

  const ids = body.data.ids ?? [];
  if (ids.length === 0) {
    return NextResponse.json(
      { success: false, error: "no-ids" },
      { status: 400 },
    );
  }

  // updateMany com filtro de workspace garante tenancy mesmo com ids alheios.
  const result = await prisma.notification.updateMany({
    where: { workspaceId, id: { in: ids }, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ success: true, updated: result.count });
}
