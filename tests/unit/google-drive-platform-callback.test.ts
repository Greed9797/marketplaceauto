import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current", () => ({
  getCurrentUserContext: vi.fn(),
  resolveConnectorWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/connectors/google-drive/oauth", () => ({
  GOOGLE_DRIVE_OAUTH_STATE_COOKIE: "adstart_gdrive_oauth_state",
  GOOGLE_DRIVE_SCOPE: "https://www.googleapis.com/auth/drive.file",
  getGoogleDriveConfigForRequest: vi.fn(async () => ({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri:
      "http://localhost/api/connectors/google-drive/callback",
  })),
  exchangeGoogleDriveCode: vi.fn(async () => ({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresIn: 3600,
    scope: null,
  })),
}));

vi.mock("@/lib/connectors/google-drive/client", () => ({
  ensureDriveFolder: vi.fn(async () => ({
    id: "folder-1",
    name: "W3 Marketplace",
  })),
  uploadDriveImage: vi.fn(),
  downloadDriveFile: vi.fn(),
}));

vi.mock("@/lib/connectors/google-drive/platform", () => ({
  connectPlatformStorage: vi.fn(async () => ({ rootFolderId: "root-1" })),
  getPlatformStorage: vi.fn(async () => null),
  getPlatformDriveAccessToken: vi.fn(async () => null),
}));

vi.mock("@/lib/connectors/credentials", () => ({
  vaultCredentialFields: vi.fn(async () => ({
    accessTokenCiphertext: "vault",
    refreshTokenCiphertext: null,
    tokenIv: "vault",
    tokenAuthTag: "vault",
    tokenKeyVersion: "vault",
    credentialSecretId: "secret-1",
    refreshCredentialSecretId: "refresh-1",
    tokenExpiresAt: new Date("2026-01-01T00:00:00Z"),
  })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connectorAccount: {
      upsert: vi.fn(async () => ({ id: "account-1" })),
    },
    platformStorage: {
      findUnique: vi.fn(async () => null),
    },
  },
}));

vi.mock("@/lib/audit/log", () => ({
  logAudit: vi.fn(async () => undefined),
}));

import { logAudit } from "@/lib/audit/log";
import {
  getCurrentUserContext,
  resolveConnectorWorkspaceAccess,
} from "@/lib/auth/current";
import { ensureDriveFolder } from "@/lib/connectors/google-drive/client";
import { connectPlatformStorage } from "@/lib/connectors/google-drive/platform";
import { prisma } from "@/lib/db/prisma";
// Estado REAL (HMAC com o secret de desenvolvimento) — o teste cobre o
 // caminho completo connect -> Google -> callback.
import { createConnectorOAuthState } from "@/lib/connectors/oauth-state";
import { GET } from "@/app/api/connectors/google-drive/callback/route";

const mockContext = vi.mocked(getCurrentUserContext);
const mockAccess = vi.mocked(resolveConnectorWorkspaceAccess);
const mockConnectPlatform = vi.mocked(connectPlatformStorage);
const mockEnsureFolder = vi.mocked(ensureDriveFolder);
const mockUpsert = vi.mocked(prisma.connectorAccount.upsert);
const mockLogAudit = vi.mocked(logAudit);

function buildCallbackUrl(state: string) {
  return `http://localhost/api/connectors/google-drive/callback?code=auth-code&state=${encodeURIComponent(state)}`;
}

function platformState(userId: string) {
  return createConnectorOAuthState({
    provider: "GOOGLE_DRIVE",
    userId,
    workspaceId: "ws-1",
    scope: "platform",
  });
}

describe("GET /api/connectors/google-drive/callback (escopo platform)", () => {
  beforeEach(() => {
    mockConnectPlatform.mockClear();
    mockEnsureFolder.mockClear();
    mockUpsert.mockClear();
    mockLogAudit.mockClear();

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
  });

  it("blocks non-admin users from connecting the global Drive", async () => {
    mockContext.mockResolvedValue({
      user: { id: "user-1", platformRole: "USER" },
    } as never);
    mockAccess.mockResolvedValue({
      user: { id: "user-1", platformRole: "USER" },
      role: "OWNER",
    } as never);

    const state = platformState("user-1");
    const response = await GET(new NextRequest(buildCallbackUrl(state)));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("error=forbidden");
    expect(mockConnectPlatform).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("connects the global storage when an ADMIN_MASTER completes the flow", async () => {
    mockContext.mockResolvedValue({
      user: { id: "admin-1", platformRole: "ADMIN_MASTER" },
    } as never);
    mockAccess.mockResolvedValue({
      user: { id: "admin-1", platformRole: "ADMIN_MASTER" },
      role: "OWNER",
    } as never);

    const state = platformState("admin-1");
    const response = await GET(new NextRequest(buildCallbackUrl(state)));

    expect(mockConnectPlatform).toHaveBeenCalledTimes(1);
    expect(mockConnectPlatform).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin-1", refreshToken: "refresh-token" }),
    );
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "connector.google_drive.connected",
        resourceType: "PlatformStorage",
        resourceId: "platform",
      }),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("connected=1");
    expect(location).toContain("platform=1");
  });

  it("keeps the workspace flow untouched when the state has no platform scope", async () => {
    mockContext.mockResolvedValue({
      user: { id: "owner-1", platformRole: "USER" },
    } as never);
    mockAccess.mockResolvedValue({
      user: { id: "owner-1", platformRole: "USER" },
      role: "OWNER",
    } as never);

    const state = createConnectorOAuthState({
      provider: "GOOGLE_DRIVE",
      userId: "owner-1",
      workspaceId: "ws-1",
    });
    const response = await GET(new NextRequest(buildCallbackUrl(state)));

    expect(mockConnectPlatform).not.toHaveBeenCalled();
    expect(mockEnsureFolder).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("connected=1");
    expect(response.headers.get("location")).not.toContain("platform=1");
  });
});
