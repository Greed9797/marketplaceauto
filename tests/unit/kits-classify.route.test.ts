import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { classifyBatchMock, getCurrentUserContextMock } = vi.hoisted(() => ({
  classifyBatchMock: vi.fn(),
  getCurrentUserContextMock: vi.fn(),
}));

vi.mock("@/lib/auth/current", () => ({
  getCurrentUserContext: getCurrentUserContextMock,
}));
vi.mock("@/lib/kits/classify", () => ({ classifyBatch: classifyBatchMock }));

import { POST } from "@/app/api/kits/classify/route";

function request(body?: unknown) {
  return new NextRequest("http://localhost/api/kits/classify", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function context(role: "OWNER" | "ADMIN" | "VIEWER" = "ADMIN") {
  return {
    user: { id: "user-1", platformRole: "USER" },
    currentWorkspace: { id: "workspace-1" },
    currentMembership: { role },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserContextMock.mockResolvedValue(context());
  classifyBatchMock.mockResolvedValue({
    processed: 3,
    needsReview: 1,
    failures: 1,
  });
});

describe("POST /api/kits/classify", () => {
  it("preserva o redirect de sessao ausente (KIT-05)", async () => {
    const redirectError = new Error("NEXT_REDIRECT");
    Object.assign(redirectError, { digest: "NEXT_REDIRECT;/login;307;" });
    getCurrentUserContextMock.mockRejectedValueOnce(redirectError);

    await expect(POST(request())).rejects.toBe(redirectError);
    expect(classifyBatchMock).not.toHaveBeenCalled();
  });

  it("nega operador sem permissao com 403 (KIT-05)", async () => {
    getCurrentUserContextMock.mockResolvedValue(context("VIEWER"));

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Sem permissão",
    });
    expect(classifyBatchMock).not.toHaveBeenCalled();
  });

  it("processa o workspace ativo e retorna contadores (KIT-03, KIT-05)", async () => {
    const response = await POST(request({ limit: 25 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { processed: 3, needsReview: 1, failures: 1 },
    });
    expect(classifyBatchMock).toHaveBeenCalledWith("workspace-1", 25);
  });

  it("rejeita limite acima de 50 sem executar o lote (KIT-05)", async () => {
    const response = await POST(request({ limit: 51 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Limite inválido",
    });
    expect(classifyBatchMock).not.toHaveBeenCalled();
  });

  it("retorna erro seguro quando o lote falha", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    classifyBatchMock.mockRejectedValueOnce(new Error("database secret"));

    try {
      const response = await POST(request());

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: "Falha ao classificar produtos",
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
