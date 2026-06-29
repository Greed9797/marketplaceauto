import type { MemberRole, PlatformRole } from "@prisma/client";

type PlatformUser = {
  platformRole:
    | PlatformRole
    | "USER"
    | "W3_ADMIN"
    | "ADMIN_MASTER"
    | "ADMIN_LIMITED"
    | "TRAFFIC_MANAGER";
};

export function isAdminMaster(user: PlatformUser) {
  return (
    user.platformRole === "ADMIN_MASTER" || user.platformRole === "W3_ADMIN"
  );
}

export function isAdminLimited(user: PlatformUser) {
  return user.platformRole === "ADMIN_LIMITED";
}

export function isTrafficManager(user: PlatformUser) {
  return user.platformRole === "TRAFFIC_MANAGER";
}

export function isInternalW3User(user: PlatformUser) {
  return isAdminMaster(user) || isAdminLimited(user) || isTrafficManager(user);
}

export function canViewBrands(user: PlatformUser) {
  return isInternalW3User(user);
}

export function canManagePlatformUsers(user: PlatformUser) {
  return isAdminMaster(user) || isAdminLimited(user);
}

/**
 * Only the Master (Gustavo) can create or modify other internal admins
 * (ADMIN_MASTER or ADMIN_LIMITED). Gestor de Contas (ADMIN_LIMITED) cannot.
 */
export function canManageAdminUsers(user: PlatformUser) {
  return isAdminMaster(user);
}

export function canManageProviderConfigs(user: PlatformUser) {
  return isAdminMaster(user) || isAdminLimited(user);
}

/**
 * Who can open the connectors page and add new accounts.
 *
 * - Admin Master + Gestor de Contas: full access.
 * - Gestor de Tráfego: blocked (no connectors per business rule).
 * - Workspace OWNER/ADMIN: full access.
 * - Workspace CLIENT: read-only, cannot add or delete connectors.
 */
export function canAddWorkspaceConnectors(
  user: PlatformUser,
  role: MemberRole,
) {
  if (isAdminMaster(user) || isAdminLimited(user)) return true;
  if (isTrafficManager(user)) return false;

  return role === "OWNER" || role === "ADMIN";
}

/**
 * Who can delete connector accounts or remove integrations.
 *
 * - Admin Master + Gestor de Contas: yes.
 * - Gestor de Tráfego: never (no delete rights).
 * - Workspace OWNER/ADMIN: yes.
 * - Workspace CLIENT: read-only.
 */
export function canDeleteWorkspaceConnectors(
  user: PlatformUser,
  role: MemberRole,
) {
  if (isAdminMaster(user) || isAdminLimited(user)) return true;
  if (isTrafficManager(user)) return false;

  return role === "OWNER" || role === "ADMIN";
}

/**
 * @deprecated Use `canAddWorkspaceConnectors` or `canDeleteWorkspaceConnectors`
 * depending on the operation. Kept for backward compatibility.
 */
export function canOperateWorkspaceConnectors(
  user: PlatformUser,
  role: MemberRole,
) {
  return canAddWorkspaceConnectors(user, role);
}

/**
 * Generic destructive-action gate. Gestor de Tráfego cannot delete anything.
 */
export function canDeleteData(user: PlatformUser, role: MemberRole) {
  if (isTrafficManager(user)) return false;
  if (isAdminMaster(user) || isAdminLimited(user)) return true;

  return role === "OWNER" || role === "ADMIN";
}

export function assertCanManageProviderConfigs(user: PlatformUser) {
  if (!canManageProviderConfigs(user)) {
    throw new Error("Sem permissao para configurar provedores.");
  }
}

export function assertCanManagePlatformUsers(user: PlatformUser) {
  if (!canManagePlatformUsers(user)) {
    throw new Error("Sem permissao para gerenciar usuarios da plataforma.");
  }
}

export function assertCanManageAdminUsers(user: PlatformUser) {
  if (!canManageAdminUsers(user)) {
    throw new Error("Somente Admin Master pode gerenciar admins internos.");
  }
}

export function assertCanDeleteWorkspaceConnectors(
  user: PlatformUser,
  role: MemberRole,
) {
  if (!canDeleteWorkspaceConnectors(user, role)) {
    throw new Error("Sem permissao para remover conectores.");
  }
}

/**
 * ADMIN_LIMITED (Gestor de Contas) can assign every role EXCEPT ADMIN_LIMITED
 * itself and ADMIN_MASTER. They cannot create other Gestores de Contas.
 */
export function canAssignPlatformRole(
  actor: PlatformUser,
  targetRole: PlatformRole,
) {
  if (isAdminMaster(actor)) return true;
  if (!isAdminLimited(actor)) return false;

  return targetRole === "TRAFFIC_MANAGER" || targetRole === "USER";
}

export function platformRoleLabel(role: PlatformRole) {
  const labels: Record<PlatformRole, string> = {
    USER: "Cliente",
    W3_ADMIN: "Master (legado)",
    ADMIN_MASTER: "Master",
    ADMIN_LIMITED: "Gestor de Contas",
    TRAFFIC_MANAGER: "Gestor de Tráfego",
  };

  return labels[role];
}
