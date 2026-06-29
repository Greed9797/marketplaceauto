import type { MemberRole, PlatformRole } from "@prisma/client";

import {
  isAdminLimited,
  isAdminMaster,
  isInternalW3User,
} from "@/lib/auth/platform-permissions";

export type WorkspaceRoleCapability =
  | "view_dashboard"
  | "edit_dashboard"
  | "manage_connectors"
  | "manage_members"
  | "manage_workspace_settings"
  | "client_read_only";

type WorkspaceRoleDefinition = {
  role: MemberRole;
  label: string;
  description: string;
  capabilities: WorkspaceRoleCapability[];
};

const workspaceRoleDefinitions: Record<MemberRole, WorkspaceRoleDefinition> = {
  OWNER: {
    role: "OWNER",
    label: "Owner",
    description: "Controle total do workspace, membros, conectores e ajustes.",
    capabilities: [
      "view_dashboard",
      "edit_dashboard",
      "manage_connectors",
      "manage_members",
      "manage_workspace_settings",
    ],
  },
  ADMIN: {
    role: "ADMIN",
    label: "Admin",
    description:
      "Opera dashboards, conectores e membros, sem alterar ajustes ou titularidade do workspace.",
    capabilities: [
      "view_dashboard",
      "edit_dashboard",
      "manage_connectors",
      "manage_members",
    ],
  },
  VIEWER: {
    role: "VIEWER",
    label: "Viewer",
    description:
      "Consulta dashboards e status dos conectores em modo somente leitura.",
    capabilities: ["view_dashboard"],
  },
  CLIENT: {
    role: "CLIENT",
    label: "Cliente",
    description: "Acesso somente leitura ao workspace liberado.",
    capabilities: ["view_dashboard", "client_read_only"],
  },
};

type MemberRoleChangeInput = {
  actorRole: MemberRole;
  actorMembershipId: string;
  targetMembershipId: string;
  targetCurrentRole: MemberRole;
  targetNextRole: MemberRole;
};

type MemberRemovalInput = {
  actorRole: MemberRole;
  actorMembershipId: string;
  targetMembershipId: string;
  targetRole: MemberRole;
};

export function getWorkspaceRoleDefinition(role: MemberRole) {
  return workspaceRoleDefinitions[role];
}

export function getWorkspaceRoleOptions() {
  return [
    workspaceRoleDefinitions.OWNER,
    workspaceRoleDefinitions.ADMIN,
    workspaceRoleDefinitions.VIEWER,
    workspaceRoleDefinitions.CLIENT,
  ];
}

function hasCapability(role: MemberRole, capability: WorkspaceRoleCapability) {
  return workspaceRoleDefinitions[role].capabilities.includes(capability);
}

export function canManageMembers(role: MemberRole) {
  return hasCapability(role, "manage_members");
}

export function assertCanManageMembers(role: MemberRole) {
  if (!canManageMembers(role)) {
    throw new Error("Sem permissao para gerenciar membros.");
  }
}

export function canEditDashboards(role: MemberRole) {
  return hasCapability(role, "edit_dashboard");
}

export function assertCanEditDashboards(role: MemberRole) {
  if (!canEditDashboards(role)) {
    throw new Error("Sem permissao para editar dashboards.");
  }
}

export function canManageConnectors(role: MemberRole) {
  return hasCapability(role, "manage_connectors");
}

export function assertCanManageConnectors(role: MemberRole) {
  if (!canManageConnectors(role)) {
    throw new Error("Sem permissao para gerenciar conectores.");
  }
}

export function canManageWorkspaceSettings(role: MemberRole) {
  return hasCapability(role, "manage_workspace_settings");
}

export function assertCanManageWorkspaceSettings(role: MemberRole) {
  if (!canManageWorkspaceSettings(role)) {
    throw new Error("Sem permissao para alterar ajustes do workspace.");
  }
}

export function canCreateWorkspace(user: { platformRole: PlatformRole }) {
  return isAdminMaster(user) || isAdminLimited(user);
}

/**
 * Who can start/stop the account-handover review timer ("passagem de conta"):
 * internal W3 managers only (Gestor de Tráfego, Gestor de Contas, Master).
 */
export function canUseAccountTimer(user: { platformRole: PlatformRole }) {
  return isInternalW3User(user);
}

/**
 * Who can see the timer LOGS (how long each manager took) for a given brand:
 * the platform Admin Master (all brands) or the OWNER of that workspace (only
 * their own brand). `membershipRole` MUST be the actor's REAL membership role on
 * the target workspace — never the synthetic OWNER injected for internal admins.
 */
export function canViewAccountTimerLogs(
  user: { platformRole: PlatformRole },
  membershipRole: MemberRole | null,
) {
  return isAdminMaster(user) || membershipRole === "OWNER";
}

/**
 * Workspace deletion (CASCADE wipes connectors, orders, metrics, members,
 * invites, sync state — irreversible). Allowed to the workspace OWNER/ADMIN of
 * the TARGET workspace, OR the platform Admin Master. Callers MUST resolve the
 * actor's membership role for the SPECIFIC workspace being deleted (never the
 * cookie-current one) before trusting `role`, and always require a typed-name
 * confirmation. The platform-level override is applied separately at the action
 * layer via `isAdminMaster`.
 */
export function canDeleteWorkspace(role: MemberRole) {
  return role === "OWNER" || role === "ADMIN";
}

export function canAssignInviteRole(role: MemberRole) {
  return role === "ADMIN" || role === "VIEWER" || role === "CLIENT";
}

export function canChangeMemberRole(input: MemberRoleChangeInput) {
  if (!canManageMembers(input.actorRole)) return false;
  if (input.actorMembershipId === input.targetMembershipId) return false;
  if (input.targetCurrentRole === "OWNER") return false;
  if (!canAssignInviteRole(input.targetNextRole)) return false;

  return true;
}

export function assertCanChangeMemberRole(input: MemberRoleChangeInput) {
  if (!canChangeMemberRole(input)) {
    throw new Error("Sem permissao para alterar esse membro.");
  }
}

export function canRemoveMember(input: MemberRemovalInput) {
  if (!canManageMembers(input.actorRole)) return false;
  if (input.actorMembershipId === input.targetMembershipId) return false;
  if (input.targetRole === "OWNER") return false;

  return true;
}

export function assertCanRemoveMember(input: MemberRemovalInput) {
  if (!canRemoveMember(input)) {
    throw new Error("Sem permissao para remover esse membro.");
  }
}
