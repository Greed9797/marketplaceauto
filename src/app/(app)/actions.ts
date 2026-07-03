"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { logAudit } from "@/lib/audit/log";
import { auth, signOut } from "@/lib/auth/auth";
import { getLaxCookieOptions } from "@/lib/auth/cookies";
import { getCurrentUserContext } from "@/lib/auth/current";
import {
  assertCanChangeMemberRole,
  assertCanRemoveMember,
  canCreateWorkspace,
  canDeleteWorkspace,
  canManageMembers,
  canManageWorkspaceSettings,
} from "@/lib/auth/permissions";
import {
  workspaceCreateSchema,
  workspaceInviteSchema,
  workspaceMemberRemoveSchema,
  workspaceMemberRoleSchema,
  workspaceSettingsSchema,
} from "@/lib/auth/schemas";
import {
  createWorkspaceForUser,
  createWorkspaceInvite,
} from "@/lib/auth/service";
import {
  canAddWorkspaceConnectors,
  isAdminMaster,
  isInternalW3User,
} from "@/lib/auth/platform-permissions";
import { prisma } from "@/lib/db/prisma";
import {
  clearWorkspaceAiKey,
  saveWorkspaceAiKey,
} from "@/lib/publisher/ai-key";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Autoriza gerenciar settings do workspace ATIVO (OWNER/ADMIN ou Master). */
async function assertCanEditActiveWorkspace() {
  const context = await getCurrentUserContext();
  const authorized =
    isAdminMaster(context.user) ||
    canManageWorkspaceSettings(context.currentMembership.role);
  if (!authorized) {
    redirect("/workspace/settings?error=forbidden");
  }
  return context.currentWorkspace.id;
}

/** Salva a chave Gemini BYOK do workspace ativo (Vault). */
export async function saveAiKeyAction(formData: FormData) {
  const workspaceId = await assertCanEditActiveWorkspace();
  const apiKey = getString(formData, "aiKey").trim();
  if (!apiKey) {
    redirect("/workspace/settings?error=invalid-aikey");
  }
  await saveWorkspaceAiKey({ workspaceId, apiKey });
  redirect("/workspace/settings?aikey=saved");
}

/** Remove a chave BYOK do workspace ativo (volta pro fallback global). */
export async function clearAiKeyAction() {
  const workspaceId = await assertCanEditActiveWorkspace();
  await clearWorkspaceAiKey(workspaceId);
  redirect("/workspace/settings?aikey=removed");
}

/**
 * Member-management gate for the ACTIVE workspace, resolved from a REAL
 * membership row (or platform Admin Master). `context.currentMembership.role`
 * can be a synthetic OWNER injected for internal admins on the cookie-selected
 * workspace — trusting it would let a non-Master internal admin manage members
 * in a brand they don't belong to. Redirects to members?error=forbidden when
 * unauthorized. Returns the real MemberRole (or null for Admin Master without a
 * membership) so callers can feed accurate actor rules downstream.
 */
async function requireRealMemberManagement(
  context: Awaited<ReturnType<typeof getCurrentUserContext>>,
) {
  const realMembership = await prisma.membership.findUnique({
    where: {
      userId_workspaceId: {
        userId: context.user.id,
        workspaceId: context.currentWorkspace.id,
      },
    },
    select: { role: true },
  });
  const isMaster = isAdminMaster(context.user);
  if (
    !isMaster &&
    !(realMembership != null && canManageMembers(realMembership.role))
  ) {
    redirect("/workspace/members?error=forbidden");
  }
  return realMembership?.role ?? null;
}

export async function switchWorkspaceAction(formData: FormData) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const workspaceId = getString(formData, "workspaceId");
  const context = await getCurrentUserContext();
  const membership = context.memberships.find(
    (item) => item.workspaceId === workspaceId,
  );

  if (!membership && !isInternalW3User(context.user)) {
    redirect("/dashboard");
  }

  if (context.currentMembership.role === "CLIENT") {
    redirect("/dashboard");
  }

  if (!membership) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });

    if (!workspace) {
      redirect("/dashboard");
    }
  }

  const cookieStore = await cookies();
  cookieStore.set("adstart_workspace_id", workspaceId, {
    ...getLaxCookieOptions({ maxAge: 60 * 60 * 24 * 180 }),
  });

  await logAudit({
    action: "workspace.switch",
    userId: session.user.id,
    workspaceId,
    resourceType: "workspace",
    resourceId: workspaceId,
  });

  redirect("/dashboard");
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function inviteMemberAction(formData: FormData) {
  const context = await getCurrentUserContext();
  // null = platform Admin Master (no real membership); a role = real OWNER/ADMIN.
  const actorRole = await requireRealMemberManagement(context);

  const parsed = workspaceInviteSchema.safeParse({
    email: getString(formData, "email"),
    role: getString(formData, "role"),
  });

  if (!parsed.success) {
    redirect("/workspace/members?error=invalid");
  }

  // Only OWNER (or platform Admin Master) may grant ADMIN — an ADMIN must not
  // mint another ADMIN at their own level (peer privilege escalation).
  if (
    parsed.data.role === "ADMIN" &&
    actorRole !== null &&
    actorRole !== "OWNER"
  ) {
    redirect("/workspace/members?error=forbidden");
  }

  await createWorkspaceInvite({
    workspaceId: context.currentWorkspace.id,
    invitedById: context.user.id,
    values: parsed.data,
  });

  redirect("/workspace/members?invited=1");
}

export async function createWorkspaceAction(formData: FormData) {
  const context = await getCurrentUserContext();
  if (!canCreateWorkspace(context.user)) {
    redirect("/workspace/settings?error=forbidden");
  }

  const parsed = workspaceCreateSchema.safeParse({
    name: getString(formData, "name"),
  });

  if (!parsed.success) {
    redirect("/workspace/settings?error=invalid-workspace");
  }

  const workspace = await createWorkspaceForUser({
    userId: context.user.id,
    values: parsed.data,
  });

  const cookieStore = await cookies();
  cookieStore.set("adstart_workspace_id", workspace.id, {
    ...getLaxCookieOptions({ maxAge: 60 * 60 * 24 * 180 }),
  });

  // Return to settings with a confirmation the page actually renders (it checks
  // ?created). The new workspace is now the active one (cookie set above).
  redirect("/workspace/settings?created=1");
}

export async function updateWorkspaceSettingsAction(formData: FormData) {
  const context = await getCurrentUserContext();

  // Per-row edit passes the target workspaceId; the current-workspace form
  // omits it and falls back to the active workspace.
  const targetWorkspaceId =
    getString(formData, "workspaceId") || context.currentWorkspace.id;

  // Authorize against a REAL membership row for the TARGET workspace, queried
  // directly from the DB. We deliberately do NOT use context.memberships: that
  // set is augmented with SYNTHETIC platform-admin memberships (e.g. a fake
  // OWNER row for the cookie-selected workspace), which would let a non-Master
  // internal admin (Gestor de Contas) edit any workspace. Only the platform
  // Admin Master gets a blanket override.
  const realMembership = await prisma.membership.findUnique({
    where: {
      userId_workspaceId: {
        userId: context.user.id,
        workspaceId: targetWorkspaceId,
      },
    },
    select: { role: true },
  });
  const authorized =
    isAdminMaster(context.user) ||
    (realMembership != null && canManageWorkspaceSettings(realMembership.role));

  if (!authorized) {
    redirect("/workspace/settings?error=forbidden");
  }

  const parsed = workspaceSettingsSchema.safeParse({
    name: getString(formData, "name"),
  });

  if (!parsed.success) {
    redirect("/workspace/settings?error=invalid-workspace");
  }

  const workspace = await prisma.workspace.update({
    where: { id: targetWorkspaceId },
    data: {
      name: parsed.data.name,
    },
  });

  await logAudit({
    action: "workspace.update",
    userId: context.user.id,
    workspaceId: workspace.id,
    resourceType: "workspace",
    resourceId: workspace.id,
    metadata: {
      name: workspace.name,
    },
  });

  redirect("/workspace/settings?saved=1");
}

export async function deleteWorkspaceAction(formData: FormData) {
  const context = await getCurrentUserContext();

  const targetWorkspaceId = getString(formData, "workspaceId");
  const confirmName = getString(formData, "confirmName").trim();

  if (!targetWorkspaceId) {
    redirect("/workspace/settings?error=invalid-workspace");
  }

  // Authorize against a REAL membership row (OWNER/ADMIN) for the TARGET
  // workspace, or platform Admin Master. context.memberships is NOT used — it
  // carries synthetic platform-admin OWNER rows that would let a non-Master
  // internal admin delete any workspace. Deleting CASCADES away every
  // connector, order, metric, member, invite and sync row — irreversible.
  const isMaster = isAdminMaster(context.user);
  const realMembership = await prisma.membership.findUnique({
    where: {
      userId_workspaceId: {
        userId: context.user.id,
        workspaceId: targetWorkspaceId,
      },
    },
    select: { role: true },
  });
  const authorized =
    isMaster ||
    (realMembership != null && canDeleteWorkspace(realMembership.role));

  if (!authorized) {
    redirect("/workspace/settings?error=forbidden");
  }

  // Orphan guard: a non-Master user must not delete their last workspace and
  // lock themselves out (the cascade also drops their membership). Admin Master
  // is exempt — they manage brands without belonging to them.
  if (!isMaster) {
    const membershipCount = await prisma.membership.count({
      where: { userId: context.user.id },
    });
    if (membershipCount <= 1) {
      redirect("/workspace/settings?error=last-workspace");
    }
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: targetWorkspaceId },
    select: { id: true, name: true },
  });

  if (!workspace) {
    redirect("/workspace/settings?error=invalid-workspace");
  }

  // Typed-name confirmation guard: the submitted name must match exactly.
  if (confirmName !== workspace.name) {
    redirect("/workspace/settings?error=confirm-mismatch");
  }

  // Audit BEFORE the row (and its cascade children) disappear.
  await logAudit({
    action: "workspace.delete",
    userId: context.user.id,
    workspaceId: workspace.id,
    resourceType: "workspace",
    resourceId: workspace.id,
    metadata: {
      name: workspace.name,
    },
  });

  await prisma.workspace.delete({ where: { id: workspace.id } });

  // If the active workspace was the one deleted, drop the cookie so the next
  // request re-resolves to a workspace the user still belongs to.
  if (context.currentWorkspace.id === workspace.id) {
    const cookieStore = await cookies();
    cookieStore.delete("adstart_workspace_id");
  }

  redirect("/workspace/settings?deleted=1");
}

export async function updateMemberRoleAction(formData: FormData) {
  const context = await getCurrentUserContext();
  await requireRealMemberManagement(context);

  const parsed = workspaceMemberRoleSchema.safeParse({
    membershipId: getString(formData, "membershipId"),
    role: getString(formData, "role"),
  });

  if (!parsed.success) {
    redirect("/workspace/members?error=invalid");
  }

  const target = await prisma.membership.findFirst({
    where: {
      id: parsed.data.membershipId,
      workspaceId: context.currentWorkspace.id,
    },
    select: {
      id: true,
      role: true,
      userId: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!target) {
    redirect("/workspace/members?error=not-found");
  }

  assertCanChangeMemberRole({
    actorRole: context.currentMembership.role,
    actorMembershipId: context.currentMembership.id,
    targetMembershipId: target.id,
    targetCurrentRole: target.role,
    targetNextRole: parsed.data.role,
  });

  await prisma.membership.update({
    where: { id: target.id },
    data: { role: parsed.data.role },
  });

  await logAudit({
    action: "workspace.member.role_update",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
    resourceType: "membership",
    resourceId: target.id,
    metadata: {
      targetUserId: target.userId,
      targetEmail: target.user.email,
      oldRole: target.role,
      newRole: parsed.data.role,
    },
  });

  redirect("/workspace/members?updated=1");
}

export async function removeMemberAction(formData: FormData) {
  const context = await getCurrentUserContext();
  await requireRealMemberManagement(context);

  const parsed = workspaceMemberRemoveSchema.safeParse({
    membershipId: getString(formData, "membershipId"),
  });

  if (!parsed.success) {
    redirect("/workspace/members?error=invalid");
  }

  const target = await prisma.membership.findFirst({
    where: {
      id: parsed.data.membershipId,
      workspaceId: context.currentWorkspace.id,
    },
    select: {
      id: true,
      role: true,
      userId: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!target) {
    redirect("/workspace/members?error=not-found");
  }

  assertCanRemoveMember({
    actorRole: context.currentMembership.role,
    actorMembershipId: context.currentMembership.id,
    targetMembershipId: target.id,
    targetRole: target.role,
  });

  await prisma.membership.delete({
    where: { id: target.id },
  });

  await logAudit({
    action: "workspace.member.remove",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
    resourceType: "membership",
    resourceId: target.id,
    metadata: {
      targetUserId: target.userId,
      targetEmail: target.user.email,
      oldRole: target.role,
    },
  });

  redirect("/workspace/members?removed=1");
}

export async function manualSyncAction(): Promise<{
  ok: boolean;
  reason: string;
}> {
  const context = await getCurrentUserContext();

  // Read-only roles (VIEWER/CLIENT) must not trigger a sync: it consumes
  // provider API quota and holds the workspace sync lock. Mirror the connector
  // operate gate — OWNER/ADMIN and internal admins only. The button is also
  // hidden for these roles in the topbar, but the server is the real boundary.
  if (
    !canAddWorkspaceConnectors(context.user, context.currentMembership.role)
  ) {
    return { ok: false, reason: "forbidden" };
  }

  const { triggerWorkspaceSyncIfStale } =
    await import("@/lib/workspace/sync-orchestrator");
  const outcome = await triggerWorkspaceSyncIfStale({
    workspaceId: context.currentWorkspace.id,
    triggeredBy: `manual:${context.user.id}`,
    // Manual sync also drives the historical backfill so each click pulls more
    // of the account's history (multiple 3-month batches per run, until the
    // 3-year window is covered).
    includeBackfill: true,
    thresholdMs: 0,
  });
  return { ok: outcome.triggered, reason: outcome.reason };
}
