import { describe, expect, it } from "vitest";

import { pickDefaultMembership } from "@/lib/auth/current";

type TestMembership = { id: string; workspaceId: string };

// memberships are always ordered createdAt asc by the prisma query, so the
// first element is the oldest workspace.
const empty: TestMembership = { id: "m-empty", workspaceId: "ws-empty" };
const populated: TestMembership = { id: "m-data", workspaceId: "ws-data" };
const memberships = [empty, populated];

describe("pickDefaultMembership", () => {
  it("uses the cookie-selected workspace when the user is a member of it", () => {
    const result = pickDefaultMembership({
      memberships,
      selectedWorkspaceId: "ws-empty",
      connectorCountByWorkspace: new Map([["ws-data", 5]]),
    });
    expect(result).toBe(empty);
  });

  it("prefers the workspace with the most ACTIVE connectors when no cookie matches", () => {
    const result = pickDefaultMembership({
      memberships,
      selectedWorkspaceId: undefined,
      connectorCountByWorkspace: new Map([["ws-data", 2]]),
    });
    expect(result).toBe(populated);
  });

  it("ignores a cookie pointing to a workspace the user does not belong to", () => {
    const result = pickDefaultMembership({
      memberships,
      selectedWorkspaceId: "ws-foreign",
      connectorCountByWorkspace: new Map([["ws-data", 3]]),
    });
    expect(result).toBe(populated);
  });

  it("falls back to the oldest workspace on a tie / no connectors", () => {
    const result = pickDefaultMembership({
      memberships,
      selectedWorkspaceId: undefined,
      connectorCountByWorkspace: new Map(),
    });
    expect(result).toBe(empty);
  });

  it("returns the only workspace without consulting counts", () => {
    const single = [populated];
    const result = pickDefaultMembership({
      memberships: single,
      selectedWorkspaceId: undefined,
    });
    expect(result).toBe(populated);
  });

  it("keeps memberships[0] when counts are not provided despite multiple workspaces", () => {
    const result = pickDefaultMembership({
      memberships,
      selectedWorkspaceId: undefined,
    });
    expect(result).toBe(empty);
  });
});
