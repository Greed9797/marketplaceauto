import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMocks, sendEmailMock } = vi.hoisted(() => ({
  prismaMocks: {
    notificationChannel: { findUnique: vi.fn() },
  },
  sendEmailMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMocks }));
vi.mock("@/lib/email/resend", () => ({
  sendTransactionalEmail: sendEmailMock,
}));

import { dispatchNotifications } from "@/lib/notifications/channels";

const NOTIFICATION = {
  type: "roas_drop",
  severity: "critical" as const,
  title: "Queda de ROAS na conta",
  body: "ROAS caiu de 10 para 3.",
  entityType: "connector_account",
  entityId: "acc-1",
  metadata: { scope: "account" },
};

const instantSleep = () => Promise.resolve();

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  prismaMocks.notificationChannel.findUnique.mockResolvedValue(null);
});

describe("dispatchNotifications", () => {
  it("entrega ao webhook com payload completo (CHAN-01)", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) => ({ ok: true, status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    prismaMocks.notificationChannel.findUnique.mockResolvedValue({
      workspaceId: "ws-1",
      webhookUrl: "https://hooks.example/abc",
      notifyEmail: null,
      enabled: true,
    });

    const result = await dispatchNotifications("ws-1", [NOTIFICATION], {
      sleep: instantSleep,
    });

    expect(result.delivered).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      workspace: "ws-1",
      type: "roas_drop",
      severity: "critical",
      title: "Queda de ROAS na conta",
      entityId: "acc-1",
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("reintenta ate 3 vezes e registra falha sem lancar erro (CHAN-02)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      prismaMocks.notificationChannel.findUnique.mockResolvedValue({
        workspaceId: "ws-1",
        webhookUrl: "https://hooks.example/abc",
        notifyEmail: null,
        enabled: true,
      });

      const result = await dispatchNotifications("ws-1", [NOTIFICATION], {
        sleep: instantSleep,
      });

      expect(result.delivered).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("webhook delivery failed"),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("envia e-mail quando configurado (CHAN-01)", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    sendEmailMock.mockResolvedValue({ skipped: false });
    prismaMocks.notificationChannel.findUnique.mockResolvedValue({
      workspaceId: "ws-1",
      webhookUrl: null,
      notifyEmail: "gestor@w3.com.br",
      enabled: true,
    });

    await dispatchNotifications("ws-1", [NOTIFICATION], { sleep: instantSleep });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "gestor@w3.com.br",
        subject: expect.stringContaining("[W3 CRÍTICO]"),
      }),
    );
  });

  it("nao entrega nada sem canal habilitado (CHAN-04)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    prismaMocks.notificationChannel.findUnique.mockResolvedValue(null);

    const result = await dispatchNotifications("ws-1", [NOTIFICATION]);

    expect(result.delivered).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("canal desabilitado nao entrega (CHAN-04)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    prismaMocks.notificationChannel.findUnique.mockResolvedValue({
      workspaceId: "ws-1",
      webhookUrl: "https://hooks.example/abc",
      notifyEmail: "gestor@w3.com.br",
      enabled: false,
    });

    const result = await dispatchNotifications("ws-1", [NOTIFICATION]);

    expect(result.delivered).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
