import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMocks } = vi.hoisted(() => ({
  prismaMocks: {
    connectorAccount: { findMany: vi.fn() },
    dailyMetric: { groupBy: vi.fn() },
    ecommerceOrder: { groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMocks }));

import { detectShopeeAccountRoasDrop } from "@/lib/notifications/shopee-account-rule";

const ACCOUNT = {
  id: "acc-shopee-1",
  accountName: "Loja Shopee Principal",
};

function spendRow(accountId: string, spend: number) {
  return { connectorAccountId: accountId, _sum: { spend } };
}

function revenueRow(accountId: string, orderTotal: number) {
  return {
    connectorAccountId: accountId,
    _sum: { orderTotal },
    _count: { _all: 1 },
  };
}

/**
 * Cenário padrão: baseline ROAS 10 (spend 100 / receita 1000) e recente
 * configurável. Janelas: [recentStart, recentEnd) e [baselineStart,
 * baselineEnd) com lag de 72h já embutido.
 */
function mockWindows(options: {
  baselineSpend?: number;
  baselineRevenue?: number;
  recentSpend?: number;
  recentRevenue?: number;
}) {
  const b = { spend: options.baselineSpend ?? 100 };
  const r = { spend: options.recentSpend ?? 30 };

  prismaMocks.dailyMetric.groupBy.mockImplementation((() => {
    let call = 0;
    return async () => {
      call += 1;
      // 1ª chamada = janela recente; 2ª = baseline.
      if (call === 1) return [spendRow(ACCOUNT.id, r.spend)];
      return [spendRow(ACCOUNT.id, b.spend)];
    };
  })());

  prismaMocks.ecommerceOrder.groupBy.mockImplementation((() => {
    let call = 0;
    return async () => {
      call += 1;
      if (call === 1)
        return [revenueRow(ACCOUNT.id, options.recentRevenue ?? 90)];
      return [revenueRow(ACCOUNT.id, options.baselineRevenue ?? 1000)];
    };
  })());
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.connectorAccount.findMany.mockResolvedValue([ACCOUNT]);
});

describe("detectShopeeAccountRoasDrop", () => {
  it("alerta queda brusca no nível conta (ROAS 10 -> 3, warning)", async () => {
    mockWindows({});

    const drafts = await detectShopeeAccountRoasDrop("ws-1");

    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft.type).toBe("roas_drop");
    expect(draft.severity).toBe("warning");
    expect(draft.entityId).toBe(ACCOUNT.id);
    expect(draft.entityType).toBe("connector_account");
    expect(draft.metadata).toMatchObject({
      scope: "account",
      baselineRoas: 10,
      recentRoas: 3,
    });
  });

  it("marca critical quando a razao cai abaixo de 25%", async () => {
    // Baseline ROAS 10; recente ROAS ~0.67 -> razao ~0.067.
    mockWindows({ recentRevenue: 20 });

    const drafts = await detectShopeeAccountRoasDrop("ws-1");

    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.severity).toBe("critical");
  });

  it("nao alerta com gasto baseline abaixo do piso de R$50", async () => {
    mockWindows({ baselineSpend: 40 });

    await expect(detectShopeeAccountRoasDrop("ws-1")).resolves.toEqual([]);
  });

  it("nao alerta com gasto recente abaixo do piso de R$20", async () => {
    mockWindows({ recentSpend: 10 });

    await expect(detectShopeeAccountRoasDrop("ws-1")).resolves.toEqual([]);
  });

  it("nao alerta quando o ROAS baseline e menor que 3", async () => {
    // Baseline ROAS 2 (200/100); recente em colapso absoluto.
    mockWindows({ baselineRevenue: 200, recentRevenue: 1 });

    await expect(detectShopeeAccountRoasDrop("ws-1")).resolves.toEqual([]);
  });

  it("nao alerta conta estavel (razao >= 50%)", async () => {
    // Baseline ROAS 10; recente ROAS 6 -> razao 0.6.
    mockWindows({ recentRevenue: 180 });

    await expect(detectShopeeAccountRoasDrop("ws-1")).resolves.toEqual([]);
  });

  it("ignora workspaces sem conta Shopee Ads ativa", async () => {
    prismaMocks.connectorAccount.findMany.mockResolvedValue([]);

    const drafts = await detectShopeeAccountRoasDrop("ws-1");

    expect(drafts).toEqual([]);
    expect(prismaMocks.dailyMetric.groupBy).not.toHaveBeenCalled();
  });

  it("so considera contas ativas na busca", async () => {
    mockWindows({});

    await detectShopeeAccountRoasDrop("ws-1");

    expect(prismaMocks.connectorAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ConnectorStatus.ACTIVE,
          provider: ConnectorProvider.SHOPEE_ADS,
        }),
      }),
    );
  });

  it("aplica o lag de 72h como limite superior da janela recente", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-24T12:00:00Z") });
    try {
      mockWindows({});
      await detectShopeeAccountRoasDrop("ws-1");

      const firstCall = (
        prismaMocks.dailyMetric.groupBy as ReturnType<typeof vi.fn>
      ).mock.calls[0]![0] as { where: { date: { lt: Date } } };

      expect(new Date(firstCall.where.date.lt).toISOString()).toBe(
        "2026-08-21T12:00:00.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
