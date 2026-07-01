import type { getCurrentUserContext } from "@/lib/auth/current";
import {
  canManageMembers,
  canManageWorkspaceSettings,
  canViewAccountTimerLogs,
  getWorkspaceRoleDefinition,
} from "@/lib/auth/permissions";
import {
  canAddWorkspaceConnectors,
  canManagePlatformUsers,
  canManageProviderConfigs,
  canViewBrands,
} from "@/lib/auth/platform-permissions";

import { logoutAction } from "@/app/(app)/actions";

import { SidebarClient, type SidebarNavItem } from "./sidebar-client";

type AppContext = Awaited<ReturnType<typeof getCurrentUserContext>>;

export function Sidebar({ context }: { context: AppContext }) {
  const navItems: SidebarNavItem[] = [
    {
      label: "Dashboard",
      href: "/dashboard",
      icon: "dashboard",
      section: "overview",
    },
    ...(canViewBrands(context.user)
      ? [
          {
            label: "Marcas",
            href: "/dashboards",
            icon: "brands" as const,
            section: "overview" as const,
          },
        ]
      : []),
    ...(canManagePlatformUsers(context.user)
      ? [
          {
            label: "Usuários",
            href: "/platform/users",
            icon: "users" as const,
            section: "manage" as const,
          },
        ]
      : []),
    ...(canAddWorkspaceConnectors(context.user, context.currentMembership.role)
      ? [
          {
            label: "Clientes",
            href: "/clientes",
            icon: "clientes" as const,
            section: "manage" as const,
          },
          {
            label: "Conectores",
            href: "/connectors",
            icon: "connectors" as const,
            section: "manage" as const,
          },
        ]
      : []),
    ...(canManageMembers(context.currentMembership.role)
      ? [
          {
            label: "Membros",
            href: "/workspace/members",
            icon: "users" as const,
            section: "manage" as const,
          },
        ]
      : []),
    ...(canViewAccountTimerLogs(context.user, context.currentMembership.role)
      ? [
          {
            label: "Tempo de contas",
            href: "/dashboards/tempo",
            icon: "timer" as const,
            section: "manage" as const,
          },
        ]
      : []),
    {
      label: "Perfil",
      href: "/profile",
      icon: "profile",
      section: "account",
    },
    { label: "FAQ / Ajuda", href: "/faq", icon: "help", section: "account" },
    ...(canManageWorkspaceSettings(context.currentMembership.role)
      ? [
          {
            label: "Conta e workspaces",
            href: "/workspace/settings",
            icon: "settings" as const,
            section: "account" as const,
          },
        ]
      : []),
    ...(canManageProviderConfigs(context.user)
      ? [
          {
            label: "Config. conectores",
            href: "/connectors/settings",
            icon: "settings" as const,
            section: "account" as const,
          },
        ]
      : []),
  ];

  return (
    <SidebarClient
      currentRoleLabel={
        getWorkspaceRoleDefinition(context.currentMembership.role).label
      }
      currentWorkspace={{
        id: context.currentWorkspace.id,
        name: context.currentWorkspace.name,
      }}
      logoutAction={logoutAction}
      navItems={navItems}
      userEmail={context.user.email}
      userImage={context.user.image ?? null}
      userName={context.user.name}
    />
  );
}
