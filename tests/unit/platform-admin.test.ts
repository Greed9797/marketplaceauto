import { describe, expect, it } from "vitest";

import {
  assertCanManageProviderConfigs,
  canAddWorkspaceConnectors,
  canAssignPlatformRole,
  canDeleteWorkspaceConnectors,
  canManageAdminUsers,
  canManagePlatformUsers,
  canManageProviderConfigs,
  canViewBrands,
} from "@/lib/auth/platform-permissions";

describe("platform admin permissions", () => {
  it("allows only Master and Limited admins to manage provider configurations", () => {
    expect(canManageProviderConfigs({ platformRole: "ADMIN_MASTER" })).toBe(
      true,
    );
    expect(canManageProviderConfigs({ platformRole: "ADMIN_LIMITED" })).toBe(
      true,
    );
    expect(canManageProviderConfigs({ platformRole: "W3_ADMIN" })).toBe(true);
    expect(canManageProviderConfigs({ platformRole: "TRAFFIC_MANAGER" })).toBe(
      false,
    );
    expect(canManageProviderConfigs({ platformRole: "USER" })).toBe(false);
  });

  it("throws a stable permission error for non-platform admins", () => {
    expect(() =>
      assertCanManageProviderConfigs({ platformRole: "USER" }),
    ).toThrow("Sem permissao para configurar provedores.");
  });

  it("keeps platform user management split between Master and Limited admins", () => {
    expect(canManagePlatformUsers({ platformRole: "ADMIN_MASTER" })).toBe(true);
    expect(canManagePlatformUsers({ platformRole: "ADMIN_LIMITED" })).toBe(
      true,
    );
    expect(canManagePlatformUsers({ platformRole: "TRAFFIC_MANAGER" })).toBe(
      false,
    );
    expect(canManageAdminUsers({ platformRole: "ADMIN_MASTER" })).toBe(true);
    expect(canManageAdminUsers({ platformRole: "ADMIN_LIMITED" })).toBe(false);
  });

  it("prevents Limited admins from creating other internal admins", () => {
    expect(
      canAssignPlatformRole({ platformRole: "ADMIN_MASTER" }, "ADMIN_MASTER"),
    ).toBe(true);
    expect(
      canAssignPlatformRole({ platformRole: "ADMIN_MASTER" }, "ADMIN_LIMITED"),
    ).toBe(true);
    expect(
      canAssignPlatformRole({ platformRole: "ADMIN_LIMITED" }, "ADMIN_MASTER"),
    ).toBe(false);
    expect(
      canAssignPlatformRole({ platformRole: "ADMIN_LIMITED" }, "ADMIN_LIMITED"),
    ).toBe(false);
    expect(
      canAssignPlatformRole(
        { platformRole: "ADMIN_LIMITED" },
        "TRAFFIC_MANAGER",
      ),
    ).toBe(true);
    expect(
      canAssignPlatformRole({ platformRole: "ADMIN_LIMITED" }, "USER"),
    ).toBe(true);
  });

  it("blocks traffic managers from any connector access (no add, no delete)", () => {
    const manager = { platformRole: "TRAFFIC_MANAGER" } as const;
    expect(canViewBrands(manager)).toBe(true);
    expect(canAddWorkspaceConnectors(manager, "VIEWER")).toBe(false);
    expect(canDeleteWorkspaceConnectors(manager, "VIEWER")).toBe(false);
    expect(canManageProviderConfigs(manager)).toBe(false);
  });

  it("keeps workspace clients read-only", () => {
    const client = { platformRole: "USER" } as const;
    expect(canViewBrands(client)).toBe(false);
    expect(canAddWorkspaceConnectors(client, "CLIENT")).toBe(false);
    expect(canDeleteWorkspaceConnectors(client, "CLIENT")).toBe(false);
    expect(canManagePlatformUsers(client)).toBe(false);
  });
});
