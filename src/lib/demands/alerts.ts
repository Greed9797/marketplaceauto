import "server-only";

import {
  DemandAlertRecipient,
  DemandAlertStatus,
  DemandAlertThreshold,
} from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { sendMcrmWhatsapp } from "@/lib/demands/mcrm";
import { elapsedDemandSeconds } from "@/lib/demands/timer";
import { getSecretStore } from "@/lib/security/secret-store";

const STALE_CLAIM_MS = 5 * 60 * 1000;
const MAX_ERROR_LENGTH = 300;

export function reachedDemandThresholds(
  elapsedSeconds: number,
  targetMinutes: number,
): DemandAlertThreshold[] {
  const targetSeconds = targetMinutes * 60;
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) return [];
  const thresholds: DemandAlertThreshold[] = [];
  if (elapsedSeconds >= targetSeconds * 1.5) thresholds.push(DemandAlertThreshold.OVER_BY_50);
  if (elapsedSeconds >= targetSeconds * 2) thresholds.push(DemandAlertThreshold.OVER_BY_100);
  return thresholds;
}

export function recipientsForDemandThreshold(
  threshold: DemandAlertThreshold,
): DemandAlertRecipient[] {
  return threshold === DemandAlertThreshold.OVER_BY_50
    ? [DemandAlertRecipient.ASSIGNEE]
    : [
        DemandAlertRecipient.ASSIGNEE,
        DemandAlertRecipient.LEADER,
        DemandAlertRecipient.GROUP,
      ];
}

function wholeMinutes(seconds: number) {
  return Math.max(0, Math.floor(seconds / 60));
}

export function buildDemandAlertMessage(input: {
  threshold: DemandAlertThreshold;
  title: string;
  categoryName: string;
  assigneeName: string;
  targetMinutes: number;
  elapsedSeconds: number;
}) {
  const isCritical = input.threshold === DemandAlertThreshold.OVER_BY_100;
  return [
    isCritical ? "🚨 Demanda crítica: 100% acima da meta" : "⚠️ Demanda: 50% acima da meta",
    input.title,
    `Responsável: ${input.assigneeName}`,
    `Categoria: ${input.categoryName}`,
    `Meta: ${input.targetMinutes} min · Tempo atual: ${wholeMinutes(input.elapsedSeconds)} min`,
    "O timer continua rodando no Kanban.",
  ].join("\n");
}

function retryAt(now: Date, attempts: number) {
  const delayMinutes = Math.min(60, 2 ** Math.min(5, Math.max(0, attempts)));
  return new Date(now.getTime() + delayMinutes * 60 * 1000);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Falha desconhecida no envio.";
  return message.slice(0, MAX_ERROR_LENGTH);
}

async function releaseClaim(alertId: string) {
  await prisma.demandAlert.update({
    where: { id: alertId },
    data: { status: DemandAlertStatus.PENDING, nextAttemptAt: null },
  });
}

async function resolveAlertDelivery(input: {
  taskId: string;
  threshold: DemandAlertThreshold;
  recipient: DemandAlertRecipient;
  now: Date;
}) {
  const task = await prisma.demandTask.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      workspaceId: true,
      assigneeId: true,
      title: true,
      status: true,
      accumulatedSeconds: true,
      runningSince: true,
      category: { select: { name: true, targetMinutes: true } },
      assignee: { select: { name: true, email: true } },
    },
  });
  if (!task || task.status !== "RUNNING" || !task.runningSince) return null;

  const elapsedSeconds = elapsedDemandSeconds(task, input.now);
  if (!reachedDemandThresholds(elapsedSeconds, task.category.targetMinutes).includes(input.threshold)) {
    return null;
  }

  const [config, assigneeProfile] = await Promise.all([
    prisma.demandNotificationConfig.findUnique({ where: { workspaceId: task.workspaceId } }),
    prisma.demandMemberProfile.findUnique({
      where: { workspaceId_userId: { workspaceId: task.workspaceId, userId: task.assigneeId } },
    }),
  ]);
  if (!config?.enabled || !config.mcrmBaseUrl || !config.mcrmTokenSecretId) {
    throw new Error("A integração do MCRM não está completamente configurada.");
  }

  let conversationId: string | null = null;
  if (input.recipient === DemandAlertRecipient.ASSIGNEE) {
    conversationId = assigneeProfile?.mcrmConversationId ?? null;
  } else if (input.recipient === DemandAlertRecipient.GROUP) {
    conversationId = config.generalGroupConversationId;
  } else if (assigneeProfile?.leaderUserId) {
    const leaderProfile = await prisma.demandMemberProfile.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: task.workspaceId,
          userId: assigneeProfile.leaderUserId,
        },
      },
      select: { mcrmConversationId: true },
    });
    conversationId = leaderProfile?.mcrmConversationId ?? null;
  }
  if (!conversationId) {
    throw new Error("A conversa de um destinatário ainda não foi configurada.");
  }

  return {
    config,
    conversationId,
    message: buildDemandAlertMessage({
      threshold: input.threshold,
      title: task.title,
      categoryName: task.category.name,
      assigneeName: task.assignee.name || task.assignee.email,
      targetMinutes: task.category.targetMinutes,
      elapsedSeconds,
    }),
  };
}

async function processAlert(input: {
  taskId: string;
  threshold: DemandAlertThreshold;
  recipient: DemandAlertRecipient;
  now: Date;
}) {
  const alert = await prisma.demandAlert.upsert({
    where: {
      taskId_threshold_recipient: {
        taskId: input.taskId,
        threshold: input.threshold,
        recipient: input.recipient,
      },
    },
    create: {
      taskId: input.taskId,
      threshold: input.threshold,
      recipient: input.recipient,
    },
    update: {},
  });
  if (alert.status === DemandAlertStatus.SENT) return "skipped" as const;

  const claimed = await prisma.demandAlert.updateMany({
    where: {
      id: alert.id,
      OR: [
        {
          status: { in: [DemandAlertStatus.PENDING, DemandAlertStatus.FAILED] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: input.now } }],
        },
        {
          status: DemandAlertStatus.SENDING,
          updatedAt: { lt: new Date(input.now.getTime() - STALE_CLAIM_MS) },
        },
      ],
    },
    data: {
      status: DemandAlertStatus.SENDING,
      attempts: { increment: 1 },
      nextAttemptAt: null,
      lastError: null,
    },
  });
  if (claimed.count !== 1) return "skipped" as const;

  try {
    const delivery = await resolveAlertDelivery(input);
    if (!delivery) {
      await releaseClaim(alert.id);
      return "skipped" as const;
    }
    const token = await getSecretStore().getSecret(delivery.config.mcrmTokenSecretId!);
    await sendMcrmWhatsapp({
      baseUrl: delivery.config.mcrmBaseUrl!,
      token,
      conversationId: delivery.conversationId,
      body: delivery.message,
      idempotencyKey: `demand-alert:${alert.id}`,
    });
    await prisma.demandAlert.update({
      where: { id: alert.id },
      data: {
        status: DemandAlertStatus.SENT,
        sentAt: input.now,
        conversationId: delivery.conversationId,
        nextAttemptAt: null,
        lastError: null,
      },
    });
    return "sent" as const;
  } catch (error) {
    await prisma.demandAlert.update({
      where: { id: alert.id },
      data: {
        status: DemandAlertStatus.FAILED,
        nextAttemptAt: retryAt(input.now, alert.attempts + 1),
        lastError: safeError(error),
      },
    });
    return "failed" as const;
  }
}

export async function processDueDemandAlerts(now = new Date()) {
  const configs = await prisma.demandNotificationConfig.findMany({
    where: {
      enabled: true,
      mcrmBaseUrl: { not: null },
      mcrmTokenSecretId: { not: null },
    },
    select: { workspaceId: true },
  });
  if (configs.length === 0) return { tasks: 0, sent: 0, failed: 0, skipped: 0 };

  const tasks = await prisma.demandTask.findMany({
    where: {
      workspaceId: { in: configs.map((config) => config.workspaceId) },
      status: "RUNNING",
      runningSince: { not: null },
    },
    select: {
      id: true,
      status: true,
      accumulatedSeconds: true,
      runningSince: true,
      category: { select: { targetMinutes: true } },
    },
  });

  const stats = { tasks: tasks.length, sent: 0, failed: 0, skipped: 0 };
  for (const task of tasks) {
    const elapsedSeconds = elapsedDemandSeconds(task, now);
    for (const threshold of reachedDemandThresholds(elapsedSeconds, task.category.targetMinutes)) {
      for (const recipient of recipientsForDemandThreshold(threshold)) {
        const result = await processAlert({ taskId: task.id, threshold, recipient, now });
        stats[result] += 1;
      }
    }
  }
  return stats;
}
