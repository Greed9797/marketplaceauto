import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canManageMembers } from "@/lib/auth/permissions";

export async function getDemandBoard() {
  const context = await getCurrentUserContext();
  const workspaceId = context.currentWorkspace.id;
  const canManage = canManageMembers(context.currentMembership.role);

  const [categories, tasks, memberships, profiles, config] = await Promise.all([
    prisma.demandCategory.findMany({
      where: { workspaceId },
      orderBy: [{ active: "desc" }, { position: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        targetMinutes: true,
        color: true,
        active: true,
        position: true,
      },
    }),
    prisma.demandTask.findMany({
      where: {
        workspaceId,
        ...(canManage ? {} : { assigneeId: context.user.id }),
      },
      orderBy: [{ status: "asc" }, { position: "asc" }, { updatedAt: "desc" }],
      take: 300,
      include: {
        category: { select: { id: true, name: true, targetMinutes: true, color: true } },
        assignee: { select: { id: true, name: true, email: true, image: true } },
      },
    }),
    prisma.membership.findMany({
      where: { workspaceId, user: { deletedAt: null } },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    }),
    prisma.demandMemberProfile.findMany({
      where: { workspaceId },
      select: { userId: true, leaderUserId: true, mcrmConversationId: true },
    }),
    prisma.demandNotificationConfig.findUnique({
      where: { workspaceId },
      select: { enabled: true, mcrmBaseUrl: true, mcrmTokenSecretId: true, generalGroupConversationId: true },
    }),
  ]);

  return {
    workspace: {
      id: context.currentWorkspace.id,
      name: context.currentWorkspace.name,
    },
    currentUserId: context.user.id,
    canManage,
    categories,
    tasks: tasks.map((task) => ({
      ...task,
      runningSince: task.runningSince?.toISOString() ?? null,
      pausedAt: task.pausedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    })),
    members: memberships.map((membership) => ({
      ...membership.user,
      role: membership.role,
    })),
    profiles,
    notification: config
      ? {
          enabled: config.enabled,
          mcrmBaseUrl: config.mcrmBaseUrl,
          tokenConfigured: Boolean(config.mcrmTokenSecretId),
          generalGroupConversationId: config.generalGroupConversationId,
        }
      : null,
  };
}
