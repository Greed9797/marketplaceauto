import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishKitBatchMock, requirePublisherWorkspaceMock } = vi.hoisted(
  () => ({
    publishKitBatchMock: vi.fn(),
    requirePublisherWorkspaceMock: vi.fn(),
  }),
);

vi.mock("@/lib/kits/publish", () => ({
  publishKitBatch: publishKitBatchMock,
}));
vi.mock("@/lib/publisher/route-guard", () => ({
  requirePublisherWorkspace: requirePublisherWorkspaceMock,
}));

import { POST } from "@/app/api/kits/publish/route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/kits/publish", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePublisherWorkspaceMock.mockResolvedValue({
    ok: true,
    workspaceId: "workspace-1",
  });
  publishKitBatchMock.mockResolvedValue({ publicado: 2, erros: [] });
});

describe("POST /api/kits/publish", () => {
  it("nega operador sem permissao (KPUB-01)", async () => {
    requirePublisherWorkspaceMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Sem permissão" },
        { status: 403 },
      ),
    });

    const response = await POST(request({ kitIds: ["kit-1"] }));

    expect(response.status).toBe(403);
    expect(publishKitBatchMock).not.toHaveBeenCalled();
  });

  it("rejeita lista vazia ou campos extras antes do servico", async () => {
    const empty = await POST(request({ kitIds: [] }));
    const extra = await POST(
      request({ kitIds: ["kit-1"], workspaceId: "workspace-other" }),
    );

    expect(empty.status).toBe(400);
    expect(extra.status).toBe(400);
    expect(publishKitBatchMock).not.toHaveBeenCalled();
  });

  it("publica IDs no workspace autenticado e retorna relatorio (KPUB-01, KPUB-02)", async () => {
    const response = await POST(request({ kitIds: ["kit-1", "kit-2"] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { publicado: 2, erros: [] },
    });
    expect(publishKitBatchMock).toHaveBeenCalledWith({
      kitIds: ["kit-1", "kit-2"],
      workspaceId: "workspace-1",
    });
  });

  it("retorna estoque bloqueado como parcial 200 (KPUB-03)", async () => {
    publishKitBatchMock.mockResolvedValueOnce({
      publicado: 1,
      erros: [{ kitId: "kit-2", error: "Estoque insuficiente." }],
    });

    const response = await POST(request({ kitIds: ["kit-1", "kit-2"] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        publicado: 1,
        erros: [{ kitId: "kit-2", error: "Estoque insuficiente." }],
      },
    });
  });

  it("nao expoe detalhes em erro 500", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    publishKitBatchMock.mockRejectedValueOnce(new Error("database secret"));

    try {
      const response = await POST(request({ kitIds: ["kit-1"] }));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: "Falha ao publicar kits",
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
