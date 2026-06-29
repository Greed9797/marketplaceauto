"use server";

import { redirect } from "next/navigation";

import { logAudit } from "@/lib/audit/log";
import { getCurrentUserContext } from "@/lib/auth/current";
import { prisma } from "@/lib/db/prisma";

export async function bootstrapW3AdminAction() {
  const context = await getCurrentUserContext();

  // Atomic conditional elevation: a single UPDATE that promotes this user to
  // ADMIN_MASTER only if NO platform admin exists yet. Two concurrent requests
  // can no longer both observe zero admins and both elevate (TOCTOU). The
  // string literals are implicitly cast to the PlatformRole enum by Postgres.
  const affected = await prisma.$executeRaw`
    UPDATE "w3ads"."User"
    SET "platformRole" = 'ADMIN_MASTER'
    WHERE "id" = ${context.user.id}
      AND NOT EXISTS (
        SELECT 1 FROM "w3ads"."User" existing
        WHERE existing."platformRole" IN ('ADMIN_MASTER', 'W3_ADMIN')
      )
  `;

  if (affected === 0) {
    // An admin already exists (or another concurrent bootstrap won the race).
    redirect("/connectors");
  }

  await logAudit({
    action: "platform.admin.bootstrap",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
    resourceType: "user",
    resourceId: context.user.id,
    metadata: { bootstrap: "ADMIN_MASTER" },
  });

  redirect("/connectors/settings?bootstrapped=1");
}
