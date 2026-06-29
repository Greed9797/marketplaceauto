import { describe, expect, it } from "vitest";

import {
  assertCanManageConnectors,
  assertCanManageMembers,
  canChangeMemberRole,
  canCreateWorkspace,
  canManageConnectors,
  canManageMembers,
  canManageWorkspaceSettings,
  canRemoveMember,
  getWorkspaceRoleDefinition,
  getWorkspaceRoleOptions,
} from "@/lib/auth/permissions";
import { createWorkspaceSlug } from "@/lib/auth/workspace";

describe("workspace helpers", () => {
  it("creates a stable ascii slug from a workspace name", () => {
    expect(createWorkspaceSlug("  Agência W3 Educação & Performance  ")).toBe(
      "agencia-w3-educacao-performance",
    );
  });

  it("keeps slugs usable when the workspace name has no letters", () => {
    expect(createWorkspaceSlug("!!!")).toMatch(/^workspace-[a-z0-9]+$/);
  });

  it("allows only owners and admins to manage members", () => {
    expect(canManageMembers("OWNER")).toBe(true);
    expect(canManageMembers("ADMIN")).toBe(true);
    expect(canManageMembers("VIEWER")).toBe(false);
    expect(canManageMembers("CLIENT")).toBe(false);
  });

  it("throws when a viewer tries to manage members", () => {
    expect(() => assertCanManageMembers("VIEWER")).toThrow("Sem permissao");
  });

  it("keeps the Adstart workspace role contract explicit", () => {
    expect(getWorkspaceRoleDefinition("OWNER")).toMatchObject({
      label: "Owner",
      description: "Controle total do workspace, membros, conectores e ajustes.",
    });
    expect(getWorkspaceRoleOptions().map((role) => role.role)).toEqual([
      "OWNER",
      "ADMIN",
      "VIEWER",
      "CLIENT",
    ]);
    expect(getWorkspaceRoleDefinition("CLIENT")).toMatchObject({
      label: "Cliente",
      description: "Acesso somente leitura ao workspace liberado.",
    });
  });

  it("keeps connector data owned by workspace admins, not viewers", () => {
    expect(canManageConnectors("OWNER")).toBe(true);
    expect(canManageConnectors("ADMIN")).toBe(true);
    expect(canManageConnectors("VIEWER")).toBe(false);
    expect(canManageConnectors("CLIENT")).toBe(false);
    expect(() => assertCanManageConnectors("VIEWER")).toThrow("Sem permissao");
  });

  it("limits workspace creation to internal account admins", () => {
    expect(canCreateWorkspace({ platformRole: "ADMIN_MASTER" })).toBe(true);
    expect(canCreateWorkspace({ platformRole: "W3_ADMIN" })).toBe(true);
    expect(canCreateWorkspace({ platformRole: "ADMIN_LIMITED" })).toBe(true);
    expect(canCreateWorkspace({ platformRole: "TRAFFIC_MANAGER" })).toBe(false);
    expect(canCreateWorkspace({ platformRole: "USER" })).toBe(false);
  });

  it("limits workspace settings to owners", () => {
    expect(canManageWorkspaceSettings("OWNER")).toBe(true);
    expect(canManageWorkspaceSettings("ADMIN")).toBe(false);
    expect(canManageWorkspaceSettings("VIEWER")).toBe(false);
    expect(canManageWorkspaceSettings("CLIENT")).toBe(false);
  });

  it("prevents unsafe member role changes", () => {
    expect(
      canChangeMemberRole({
        actorRole: "OWNER",
        actorMembershipId: "owner-1",
        targetMembershipId: "admin-1",
        targetCurrentRole: "ADMIN",
        targetNextRole: "VIEWER",
      }),
    ).toBe(true);
    expect(
      canChangeMemberRole({
        actorRole: "ADMIN",
        actorMembershipId: "admin-1",
        targetMembershipId: "viewer-1",
        targetCurrentRole: "VIEWER",
        targetNextRole: "ADMIN",
      }),
    ).toBe(true);
    expect(
      canChangeMemberRole({
        actorRole: "ADMIN",
        actorMembershipId: "admin-1",
        targetMembershipId: "owner-1",
        targetCurrentRole: "OWNER",
        targetNextRole: "VIEWER",
      }),
    ).toBe(false);
    expect(
      canChangeMemberRole({
        actorRole: "OWNER",
        actorMembershipId: "owner-1",
        targetMembershipId: "owner-1",
        targetCurrentRole: "OWNER",
        targetNextRole: "ADMIN",
      }),
    ).toBe(false);
  });

  it("prevents removing owners or the current user from a workspace", () => {
    expect(
      canRemoveMember({
        actorRole: "OWNER",
        actorMembershipId: "owner-1",
        targetMembershipId: "viewer-1",
        targetRole: "VIEWER",
      }),
    ).toBe(true);
    expect(
      canRemoveMember({
        actorRole: "ADMIN",
        actorMembershipId: "admin-1",
        targetMembershipId: "viewer-1",
        targetRole: "VIEWER",
      }),
    ).toBe(true);
    expect(
      canRemoveMember({
        actorRole: "OWNER",
        actorMembershipId: "owner-1",
        targetMembershipId: "owner-2",
        targetRole: "OWNER",
      }),
    ).toBe(false);
    expect(
      canRemoveMember({
        actorRole: "ADMIN",
        actorMembershipId: "admin-1",
        targetMembershipId: "admin-1",
        targetRole: "ADMIN",
      }),
    ).toBe(false);
  });
});
