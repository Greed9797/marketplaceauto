"use server";

import { redirect } from "next/navigation";

import { logAudit } from "@/lib/audit/log";
import { getCurrentUserContext } from "@/lib/auth/current";
import { validateDeleteConfirmation } from "@/lib/compliance/lgpd";
import { prisma } from "@/lib/db/prisma";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function requestDataExportAction() {
  const context = await getCurrentUserContext();

  await logAudit({
    action: "lgpd.data_export.request",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
    resourceType: "user",
    resourceId: context.user.id,
  });

  redirect("/profile/data-export?requested=1");
}

export async function requestDeleteAccountAction(formData: FormData) {
  const context = await getCurrentUserContext();
  const confirmation = getString(formData, "emailConfirmation");

  if (!validateDeleteConfirmation(context.user.email, confirmation)) {
    redirect("/profile/delete-account?error=confirmation");
  }

  await logAudit({
    action: "lgpd.delete_account.request",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
    resourceType: "user",
    resourceId: context.user.id,
  });

  await prisma.user.update({
    where: { id: context.user.id },
    data: {
      deletedAt: new Date(),
      name: "Conta em exclusão",
      passwordHash: null,
    },
  });

  await prisma.session.deleteMany({
    where: { userId: context.user.id },
  });

  redirect("/login?deleted=1");
}
