import type { NotificationSeverity } from "@/lib/notifications/rules";
import { callWithRetry } from "@/lib/connectors/retry";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { prisma } from "@/lib/db/prisma";

export type DeliverableNotification = {
  type: string;
  severity: NotificationSeverity;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: unknown;
};

type DispatchOptions = {
  /** Injetável para testes — backoff instantâneo fora de produção. */
  sleep?: (delayMs: number) => Promise<void>;
};

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  info: "INFO",
  warning: "ALERTA",
  critical: "CRÍTICO",
};

/**
 * Entrega notificações recém-criadas ao canal externo do workspace (CHAN-01).
 *
 * - Webhook genérico (compatível Discord/Slack) e/ou e-mail via Resend.
 * - 3 tentativas com backoff exponencial; falha final é logada e não
 *   interrompe o restante (CHAN-02).
 * - O cooldown/dedup de 24h acontece ANTES daqui: só chega notificação nova
 *   (CHAN-03) — quem chama entrega apenas o que `persistDrafts` criou.
 */
export async function dispatchNotifications(
  workspaceId: string,
  notifications: DeliverableNotification[],
  options: DispatchOptions = {},
): Promise<{ delivered: number }> {
  if (notifications.length === 0) return { delivered: 0 };

  const channel = await prisma.notificationChannel.findUnique({
    where: { workspaceId },
  });

  if (!channel || !channel.enabled) return { delivered: 0 };
  if (!channel.webhookUrl && !channel.notifyEmail) return { delivered: 0 };

  let delivered = 0;

  for (const notification of notifications) {
    if (channel.webhookUrl) {
      const ok = await deliverWebhook(channel.webhookUrl, workspaceId, notification, options);
      if (ok) delivered += 1;
    }

    if (channel.notifyEmail) {
      await deliverEmail(channel.notifyEmail, workspaceId, notification);
    }
  }

  return { delivered };
}

function buildPayload(workspaceId: string, notification: DeliverableNotification) {
  return {
    workspace: workspaceId,
    type: notification.type,
    severity: notification.severity,
    title: notification.title,
    body: notification.body ?? null,
    entityType: notification.entityType ?? null,
    entityId: notification.entityId ?? null,
    metadata: notification.metadata ?? null,
  };
}

async function deliverWebhook(
  url: string,
  workspaceId: string,
  notification: DeliverableNotification,
  options: DispatchOptions,
): Promise<boolean> {
  try {
    await callWithRetry(
      async () => {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(workspaceId, notification)),
        });

        if (!response.ok) {
          throw Object.assign(new Error(`webhook responded ${response.status}`), {
            status: response.status,
          });
        }
      },
      { maxAttempts: 3, baseDelayMs: 500, sleep: options.sleep },
    );
    return true;
  } catch (error: unknown) {
    console.error(
      `[notifications] webhook delivery failed for ${notification.type}/${notification.entityId ?? "-"}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return false;
  }
}

async function deliverEmail(
  to: string,
  workspaceId: string,
  notification: DeliverableNotification,
): Promise<void> {
  try {
    await sendTransactionalEmail({
      to,
      subject: `[W3 ${SEVERITY_LABEL[notification.severity]}] ${notification.title}`,
      html: `<p>${notification.body ?? notification.title}</p><p><small>Workspace: ${workspaceId} · Tipo: ${notification.type}</small></p>`,
    });
  } catch (error: unknown) {
    console.error(
      `[notifications] email delivery failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}
