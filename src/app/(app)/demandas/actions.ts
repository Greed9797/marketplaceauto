"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { logAudit } from "@/lib/audit/log";
import { getCurrentUserContext } from "@/lib/auth/current";
import { canManageMembers } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import {
  createDemandCategorySchema,
  createDemandTaskSchema,
  demandMemberProfileSchema,
  demandNotificationConfigSchema,
  demandTaskIdSchema,
} from "@/lib/demands/schemas";
import {
  completeDemandTimer,
  DemandTimerError,
  pauseDemandTimer,
  resumeDemandTimer,
  startDemandTimer,
} from "@/lib/demands/timer";
import { assertPublicHttpUrl } from "@/lib/connectors/url-guard";
import { getSecretStore } from "@/lib/security/secret-store";

export type DemandActionResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

function fail(error: string, code?: string): DemandActionResult {
  return { ok: false, error, code };
}

function refreshDemands() {
  revalidatePath("/demandas");
  revalidatePath("/demandas/configuracoes");
}

async function demandAccess() {
  const context = await getCurrentUserContext();
  return {
    context,
    workspaceId: context.currentWorkspace.id,
    canManage: canManageMembers(context.currentMembership.role),
  };
}

export async function createDemandCategoryAction(
  input: unknown,
): Promise<DemandActionResult> {
  const parsed = createDemandCategorySchema.safeParse(input);
  if (!parsed.success) return fail("Revise o nome, a meta e a cor da categoria.", "invalid_input");

  const { context, workspaceId, canManage } = await demandAccess();
  if (!canManage) return fail("Somente gestores podem criar categorias.", "forbidden");

  try {
    await prisma.demandCategory.create({ data: { workspaceId, ...parsed.data } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("Já existe uma categoria com esse nome.", "duplicate");
    }
    throw error;
  }

  await logAudit({
    action: "demand.category.create",
    userId: context.user.id,
    workspaceId,
    resourceType: "demand_category",
  });
  refreshDemands();
  return { ok: true };
}

export async function createDemandTaskAction(
  input: unknown,
): Promise<DemandActionResult> {
  const parsed = createDemandTaskSchema.safeParse(input);
  if (!parsed.success) return fail("Preencha título, categoria e responsável.", "invalid_input");

  const { context, workspaceId, canManage } = await demandAccess();
  if (!canManage && parsed.data.assigneeId !== context.user.id) {
    return fail("Você só pode criar demandas para si.", "forbidden");
  }

  const [category, membership] = await Promise.all([
    prisma.demandCategory.findFirst({
      where: { id: parsed.data.categoryId, workspaceId, active: true },
      select: { id: true },
    }),
    prisma.membership.findUnique({
      where: {
        userId_workspaceId: { userId: parsed.data.assigneeId, workspaceId },
      },
      select: { id: true },
    }),
  ]);
  if (!category || !membership) return fail("Categoria ou responsável inválido.", "invalid_scope");

  const task = await prisma.demandTask.create({
    data: {
      workspaceId,
      categoryId: category.id,
      assigneeId: parsed.data.assigneeId,
      createdById: context.user.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
    },
  });
  await logAudit({
    action: "demand.task.create",
    userId: context.user.id,
    workspaceId,
    resourceType: "demand_task",
    resourceId: task.id,
  });
  refreshDemands();
  return { ok: true };
}

type TimerOperation = "start" | "pause" | "resume" | "complete";

async function mutateDemandTimer(
  taskIdInput: unknown,
  operation: TimerOperation,
): Promise<DemandActionResult> {
  const parsedId = demandTaskIdSchema.safeParse(taskIdInput);
  if (!parsedId.success) return fail("Demanda inválida.", "invalid_input");
  const { context, workspaceId, canManage } = await demandAccess();
  const now = new Date();

  try {
    const task = await prisma.$transaction(async (tx) => {
      const current = await tx.demandTask.findFirst({
        where: { id: parsedId.data, workspaceId },
        select: {
          id: true,
          assigneeId: true,
          status: true,
          accumulatedSeconds: true,
          runningSince: true,
        },
      });
      if (!current) throw new DemandTimerError("task_not_found", "Demanda não encontrada.");
      if (!canManage && current.assigneeId !== context.user.id) {
        throw new DemandTimerError("forbidden", "Você não pode alterar esta demanda.");
      }

      let data;
      if (operation === "start") {
        if (current.status !== "TODO") {
          throw new DemandTimerError("invalid_transition", "Somente demandas a fazer podem iniciar.");
        }
        data = startDemandTimer(now);
      } else if (operation === "pause") {
        data = pauseDemandTimer(current, now);
      } else if (operation === "resume") {
        data = resumeDemandTimer(current, now);
      } else {
        data = completeDemandTimer(current, now);
      }

      const changed = await tx.demandTask.updateMany({
        where: { id: current.id, workspaceId, status: current.status },
        data,
      });
      if (changed.count !== 1) {
        throw new DemandTimerError("invalid_transition", "A demanda mudou em outra aba. Atualize o quadro.");
      }
      return current;
    });

    await logAudit({
      action: `demand.timer.${operation}`,
      userId: context.user.id,
      workspaceId,
      resourceType: "demand_task",
      resourceId: task.id,
    });
  } catch (error) {
    if (error instanceof DemandTimerError) return fail(error.message, error.code);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("Já existe outro timer rodando para este responsável.", "timer_already_running");
    }
    throw error;
  }

  refreshDemands();
  return { ok: true };
}

export async function startDemandTimerAction(taskId: unknown) {
  return mutateDemandTimer(taskId, "start");
}

export async function pauseDemandTimerAction(taskId: unknown) {
  return mutateDemandTimer(taskId, "pause");
}

export async function resumeDemandTimerAction(taskId: unknown) {
  return mutateDemandTimer(taskId, "resume");
}

export async function completeDemandTimerAction(taskId: unknown) {
  return mutateDemandTimer(taskId, "complete");
}

export async function saveDemandMemberProfileAction(
  input: unknown,
): Promise<DemandActionResult> {
  const parsed = demandMemberProfileSchema.safeParse(input);
  if (!parsed.success) return fail("Revise o membro, líder e conversa do MCRM.", "invalid_input");
  const { context, workspaceId, canManage } = await demandAccess();
  if (!canManage) return fail("Somente gestores podem configurar alertas.", "forbidden");

  const ids = [parsed.data.userId, parsed.data.leaderUserId].filter(Boolean) as string[];
  const count = await prisma.membership.count({ where: { workspaceId, userId: { in: ids } } });
  if (count !== new Set(ids).size || parsed.data.userId === parsed.data.leaderUserId) {
    return fail("Membro ou líder não pertence a este workspace.", "invalid_scope");
  }

  await prisma.demandMemberProfile.upsert({
    where: { workspaceId_userId: { workspaceId, userId: parsed.data.userId } },
    create: { workspaceId, ...parsed.data },
    update: {
      leaderUserId: parsed.data.leaderUserId,
      mcrmConversationId: parsed.data.mcrmConversationId,
    },
  });
  await logAudit({
    action: "demand.member_profile.update",
    userId: context.user.id,
    workspaceId,
    resourceType: "demand_member_profile",
    resourceId: parsed.data.userId,
  });
  refreshDemands();
  return { ok: true };
}

export async function saveDemandNotificationConfigAction(
  input: unknown,
): Promise<DemandActionResult> {
  const parsed = demandNotificationConfigSchema.safeParse(input);
  if (!parsed.success) return fail("Revise a URL, o token e a conversa do grupo.", "invalid_input");
  const { context, workspaceId, canManage } = await demandAccess();
  if (!canManage) return fail("Somente gestores podem configurar o MCRM.", "forbidden");

  if (parsed.data.mcrmBaseUrl) {
    try {
      const url = assertPublicHttpUrl(parsed.data.mcrmBaseUrl);
      if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
        return fail("Em produção, o MCRM precisa usar HTTPS.", "invalid_url");
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : "URL do MCRM inválida.", "invalid_url");
    }
  }

  const existing = await prisma.demandNotificationConfig.findUnique({
    where: { workspaceId },
    select: { mcrmTokenSecretId: true },
  });
  let tokenSecretId = existing?.mcrmTokenSecretId ?? null;
  if (parsed.data.mcrmToken) {
    const secretStore = getSecretStore();
    const secretInput = {
      name: `w3marketplace:${workspaceId}:mcrm-bearer`,
      value: parsed.data.mcrmToken,
      description: "Bearer org-scoped do MCRM para alertas do Kanban",
    };
    if (tokenSecretId) await secretStore.updateSecret(tokenSecretId, secretInput);
    else tokenSecretId = await secretStore.createSecret(secretInput);
  }
  if (parsed.data.enabled && (!parsed.data.mcrmBaseUrl || !tokenSecretId)) {
    return fail("Informe a URL e o bearer antes de ativar os alertas.", "incomplete_config");
  }

  await prisma.demandNotificationConfig.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      enabled: parsed.data.enabled,
      mcrmBaseUrl: parsed.data.mcrmBaseUrl,
      mcrmTokenSecretId: tokenSecretId,
      generalGroupConversationId: parsed.data.generalGroupConversationId,
    },
    update: {
      enabled: parsed.data.enabled,
      mcrmBaseUrl: parsed.data.mcrmBaseUrl,
      mcrmTokenSecretId: tokenSecretId,
      generalGroupConversationId: parsed.data.generalGroupConversationId,
    },
  });
  await logAudit({
    action: "demand.notification_config.update",
    userId: context.user.id,
    workspaceId,
    resourceType: "demand_notification_config",
  });
  refreshDemands();
  return { ok: true };
}
