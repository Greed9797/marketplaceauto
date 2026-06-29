import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export type AuditAction =
  | "auth.signup"
  | "auth.login"
  | "auth.logout"
  | "auth.password_reset.request"
  | "auth.password_reset.complete"
  | "connector.google_ads.connect"
  | "connector.google_ads.selection_created"
  | "connector.google_analytics.selection_created"
  | "connector.selection.connect"
  | "connector.meta.connect"
  | "connector.meta.selection_created"
  | "connector.manual.connect"
  | "connector.mercado_livre.connect"
  | "connector.nuvemshop.selection_created"
  | "connector.provider_config.create"
  | "connector.provider_config.update"
  | "connector.provider_config.delete"
  | "connector.provider_config.validate"
  | "connector.shopify.connect"
  | "connector.shopify.uninstall"
  | "connector.shopee.connect"
  | "connector.removed"
  | "lgpd.data_export.request"
  | "lgpd.delete_account.request"
  | "feedback.submit"
  | "observability.client_error"
  | "platform.admin.bootstrap"
  | "account_timer.start"
  | "account_timer.stop"
  | "account_timer.delete"
  | "workspace.create"
  | "workspace.delete"
  | "workspace.member.add"
  | "workspace.member.create"
  | "workspace.member.invite"
  | "workspace.member.remove"
  | "workspace.member.reset"
  | "workspace.member.role_update"
  | "workspace.switch"
  | "workspace.update";

type LogAuditInput = {
  action: AuditAction;
  userId?: string;
  workspaceId?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
};

export async function logAudit(input: LogAuditInput) {
  await prisma.auditLog.create({
    data: {
      action: input.action,
      userId: input.userId,
      workspaceId: input.workspaceId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
      ip: input.ip,
      userAgent: input.userAgent,
    },
  });
}
