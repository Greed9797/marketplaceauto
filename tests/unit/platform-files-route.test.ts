import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current", () => ({
  getCurrentUserContext: vi.fn(async () => ({
    user: { id: "user-1", platformRole: "USER" },
  })),
}));

vi.mock("@/lib/connectors/google-drive/client", () => ({
  downloadDriveFile: vi.fn(),
  ensureDriveFolder: vi.fn(),
  uploadDriveImage: vi.fn(),
}));

vi.mock("@/lib/connectors/google-drive/platform", () => ({
  getPlatformStorage: vi.fn(async () => null),
  getPlatformDriveAccessToken: vi.fn(async () => null),
}));

import { downloadDriveFile } from "@/lib/connectors/google-drive/client";
import { getPlatformDriveAccessToken } from "@/lib/connectors/google-drive/platform";
import { GET } from "@/app/api/platform-files/[fileId]/route";

const mockDownload = vi.mocked(downloadDriveFile);
const mockToken = vi.mocked(getPlatformDriveAccessToken);

function buildRequest() {
  return new NextRequest("http://localhost/api/platform-files/file-123");
}

describe("GET /api/platform-files/[fileId]", () => {
  beforeEach(() => {
    mockDownload.mockClear();
    mockToken.mockResolvedValue("access-token");
  });

  it("returns 404 when the global Drive is not connected", async () => {
    mockToken.mockResolvedValue(null);

    const response = await GET(buildRequest(), {
      params: Promise.resolve({ fileId: "file-123" }),
    });

    expect(response.status).toBe(404);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("serves the file through the authenticated proxy", async () => {
    const bytes = new TextEncoder().encode("png-bytes").buffer;
    mockDownload.mockResolvedValue({ bytes, contentType: "image/png" });

    const response = await GET(buildRequest(), {
      params: Promise.resolve({ fileId: "file-123" }),
    });

    expect(mockDownload).toHaveBeenCalledWith({
      accessToken: "access-token",
      fileId: "file-123",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("returns 404 when Drive reports the file as missing", async () => {
    mockDownload.mockResolvedValue(null);

    const response = await GET(buildRequest(), {
      params: Promise.resolve({ fileId: "gone" }),
    });

    expect(response.status).toBe(404);
  });

  it("maps downstream failures to a generic 500 without leaking details", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      mockDownload.mockRejectedValue(
        new Error("google api exploded: secret-value"),
      );

      const response = await GET(buildRequest(), {
        params: Promise.resolve({ fileId: "file-123" }),
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "file-fetch-failed",
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("rethrows Next control-flow errors (auth redirect) untouched", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;/login;307;",
    });
    const { getCurrentUserContext } = await import("@/lib/auth/current");
    vi.mocked(getCurrentUserContext).mockRejectedValueOnce(redirectError);

    await expect(
      GET(buildRequest(), { params: Promise.resolve({ fileId: "file-123" }) }),
    ).rejects.toBe(redirectError);
  });
});
