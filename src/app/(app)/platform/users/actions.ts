"use server";

import { redirect } from "next/navigation";

import { getCurrentUserContext } from "@/lib/auth/current";
import { hashPassword } from "@/lib/auth/password";
import {
  assertCanManagePlatformUsers,
  canAssignPlatformRole,
} from "@/lib/auth/platform-permissions";
import { platformUserCreateSchema } from "@/lib/auth/schemas";
import { prisma } from "@/lib/db/prisma";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function createPlatformUserAction(formData: FormData) {
  const context = await getCurrentUserContext();
  assertCanManagePlatformUsers(context.user);

  const parsed = platformUserCreateSchema.safeParse({
    name: getString(formData, "name"),
    email: getString(formData, "email"),
    password: getString(formData, "password"),
    platformRole: getString(formData, "platformRole"),
    workspaceId: getString(formData, "workspaceId") || undefined,
    membershipRole: getString(formData, "membershipRole") || undefined,
  });

  if (!parsed.success) {
    redirect("/platform/users?error=invalid");
  }

  const values = parsed.data;
  if (!canAssignPlatformRole(context.user, values.platformRole)) {
    redirect("/platform/users?error=role");
  }

  const isClient = values.platformRole === "USER";
  if (isClient && !values.workspaceId) {
    redirect("/platform/users?error=workspace");
  }

  const existing = await prisma.user.findUnique({
    where: { email: values.email },
    select: { id: true },
  });

  if (existing) {
    redirect("/platform/users?error=email");
  }

  const workspace = values.workspaceId
    ? await prisma.workspace.findUnique({
        where: { id: values.workspaceId },
        select: { id: true, name: true },
      })
    : null;

  if (isClient && !workspace) {
    redirect("/platform/users?error=workspace");
  }

  const passwordHash = await hashPassword(values.password);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: values.email,
        name: values.name,
        passwordHash,
        platformRole: values.platformRole,
        memberships:
          isClient && workspace
            ? {
                create: {
                  workspaceId: workspace.id,
                  role: "CLIENT",
                },
              }
            : undefined,
      },
      select: { id: true, email: true, platformRole: true },
    });

    await tx.auditLog.create({
      data: {
        action: "platform.user.create",
        userId: context.user.id,
        workspaceId: workspace?.id ?? context.currentWorkspace.id,
        resourceType: "user",
        resourceId: user.id,
        metadata: {
          email: user.email,
          platformRole: user.platformRole,
          workspaceId: workspace?.id,
          membershipRole: isClient ? "CLIENT" : null,
        },
      },
    });
  });

  redirect("/platform/users?created=1");
}
