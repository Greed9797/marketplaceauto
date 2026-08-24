import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMocks, txMocks, detectShopeeAccountRoasDropMock } = vi.hoisted(
  () => ({
    prismaMocks: {
      $transaction: vi.fn(),
      notification: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      dailyMetric: { groupBy: vi.fn() },
      produto: { findMany: vi.fn() },
      productInventory: { findMany: vi.fn() },
      connectorAccount: { findMany: vi.fn() },
      ecommerceOrderItem: { groupBy: vi.fn() },
    },
    txMocks: {
      $executeRaw: vi.fn(),
      notification: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    },
    detectShopeeAccountRoasDropMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMocks }));
vi.mock("@/lib/notifications/shopee-account-rule", () => ({
  detectShopeeAccountRoasDrop: detectShopeeAccountRoasDropMock,
}));

import {
  detectAccountQualityIssues,
  detectLowStock,
  detectRoasDrops,
  evaluateWorkspaceNotificationRules,
} from "@/lib/notifications/rules";

function metricRow(overrides: Record<string, unknown>) {
  return {
    source: ConnectorProvider.MERCADO_LIVRE_ADS,
    campaignId: "camp-1",
    campaignName: "Campanha A",
    _sum: { spend: null, revenue: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.notification.findFirst.mockResolvedValue(null);
  prismaMocks.notification.create.mockResolvedValue({});
  prismaMocks.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(txMocks),
  );
  txMocks.$executeRaw.mockResolvedValue([]);
  txMocks.notification.findFirst.mockResolvedValue(null);
  txMocks.notification.create.mockResolvedValue({});
  detectShopeeAccountRoasDropMock.mockResolvedValue([]);
  prismaMocks.ecommerceOrderItem.groupBy.mockResolvedValue([]);
});

describe("detectRoasDrops", () => {
  it("alerts when a healthy campaign collapses", async () => {
    // Baseline (janela de 7 dias anteriores): R$100 gastos, R$800 receita → ROAS 8
    // Recente (3 dias): R$50 gastos, R$120 receita → ROAS 2.4 (< 50% do baseline)
    prismaMocks.dailyMetric.groupBy
      .mockResolvedValueOnce([metricRow({})])
      .mockResolvedValueOnce([
        metricRow({ _sum: { spend: 50, revenue: 120 } }),
      ])
      .mockResolvedValueOnce([
        metricRow({ _sum: { spend: 100, revenue: 800 } }),
      ]);

    const drafts = await detectRoasDrops("ws-1");

    expect(drafts).toHaveLength(1);
    expect(drafts[0].type).toBe("roas_drop");
    expect(drafts[0].severity).toBe("warning");
    expect(drafts[0].entityId).toBe("camp-1");
    expect(drafts[0].title).toContain("Campanha A");
  });

  it("ignores campaigns with no meaningful baseline spend", async () => {
    prismaMocks.dailyMetric.groupBy
      .mockResolvedValueOnce([metricRow({})])
      .mockResolvedValueOnce([
        metricRow({ _sum: { spend: 30, revenue: 10 } }),
      ])
      .mockResolvedValueOnce([
        metricRow({ _sum: { spend: 5, revenue: 90 } }),
      ]);

    const drafts = await detectRoasDrops("ws-1");

    expect(drafts).toHaveLength(0);
  });

  it("escalates to critical on an almost total collapse", async () => {
    prismaMocks.dailyMetric.groupBy
      .mockResolvedValueOnce([metricRow({})])
      .mockResolvedValueOnce([
        metricRow({ _sum: { spend: 60, revenue: 40 } }),
      ])
      .mockResolvedValueOnce([
        metricRow({ _sum: { spend: 200, revenue: 1600 } }),
      ]);

    const drafts = await detectRoasDrops("ws-1");

    expect(drafts).toHaveLength(1);
    expect(drafts[0].severity).toBe("critical");
  });
});

describe("detectLowStock", () => {
  it("flags published products at or below the warning threshold", async () => {
    prismaMocks.produto.findMany.mockResolvedValue([
      {
        id: "prod-1",
        nomeOriginal: "Tênis Corrida",
        quantidade: 12,
        mlItemId: "MLB123",
        shopeeItemId: null,
      },
      {
        id: "prod-2",
        nomeOriginal: "Fone Bluetooth",
        quantidade: 3,
        mlItemId: null,
        shopeeItemId: "SPX9",
      },
    ]);
    prismaMocks.productInventory.findMany.mockResolvedValue([]);

    const drafts = await detectLowStock("ws-1");

    expect(drafts).toHaveLength(1);
    expect(drafts[0].entityId).toBe("prod-2");
    expect(drafts[0].severity).toBe("warning");
    expect(drafts[0].body).toContain("Shopee");
  });

  it("prefers live inventory and escalates to critical when nearly out", async () => {
    prismaMocks.produto.findMany.mockResolvedValue([
      {
        id: "prod-1",
        nomeOriginal: "Tênis Corrida",
        quantidade: 50,
        mlItemId: "MLB123",
        shopeeItemId: null,
      },
    ]);
    prismaMocks.productInventory.findMany.mockResolvedValue([
      {
        externalProductId: "MLB123",
        quantity: 1,
        syncedAt: new Date(),
      },
    ]);

    const drafts = await detectLowStock("ws-1");

    expect(drafts).toHaveLength(1);
    expect(drafts[0].severity).toBe("critical");
    expect(drafts[0].metadata).toMatchObject({ stock: 1 });
  });

  it("ignores products with healthy stock", async () => {
    prismaMocks.produto.findMany.mockResolvedValue([
      {
        id: "prod-1",
        nomeOriginal: "Tênis Corrida",
        quantidade: 40,
        mlItemId: "MLB123",
        shopeeItemId: null,
      },
    ]);
    prismaMocks.productInventory.findMany.mockResolvedValue([]);

    const drafts = await detectLowStock("ws-1");

    expect(drafts).toHaveLength(0);
  });

  it("inclui o runway em dias quando ha vendas na janela (STCK-02)", async () => {
    // Âncora da spec: estoque 4, 2 vendas/dia -> ~2 dias.
    prismaMocks.produto.findMany.mockResolvedValue([
      {
        id: "prod-1",
        nomeOriginal: "Vestido Floral",
        quantidade: 50,
        mlItemId: null,
        shopeeItemId: "SPX9",
      },
    ]);
    prismaMocks.productInventory.findMany.mockResolvedValue([
      {
        externalProductId: "SPX9",
        quantity: 4,
        sku: "SKU-A",
        syncedAt: new Date(),
      },
    ]);
    prismaMocks.ecommerceOrderItem.groupBy.mockResolvedValue([
      { sku: "SKU-A", _sum: { quantity: 28 } },
    ]);

    const drafts = await detectLowStock("ws-1");

    expect(drafts).toHaveLength(1);
    expect(drafts[0].body).toContain("cerca de 2 dias");
    expect(drafts[0].metadata).toMatchObject({
      stock: 4,
      runwayDays: 2,
    });
    expect(prismaMocks.ecommerceOrderItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-1" }),
      }),
    );
  });

  it("omite o runway sem vendas e mantem o alerta (STCK-04)", async () => {
    prismaMocks.produto.findMany.mockResolvedValue([
      {
        id: "prod-1",
        nomeOriginal: "Vestido Floral",
        quantidade: 50,
        mlItemId: null,
        shopeeItemId: "SPX9",
      },
    ]);
    prismaMocks.productInventory.findMany.mockResolvedValue([
      {
        externalProductId: "SPX9",
        quantity: 3,
        sku: "SKU-A",
        syncedAt: new Date(),
      },
    ]);
    prismaMocks.ecommerceOrderItem.groupBy.mockResolvedValue([]);

    const drafts = await detectLowStock("ws-1");

    expect(drafts).toHaveLength(1);
    expect(drafts[0].body).not.toContain("Estimativa");
    expect("runwayDays" in (drafts[0].metadata as object)).toBe(false);
  });
});

describe("detectAccountQualityIssues", () => {
  it("marks revoked accounts as critical and expired as warning", async () => {
    prismaMocks.connectorAccount.findMany.mockResolvedValue([
      {
        id: "acc-1",
        provider: ConnectorProvider.SHOPEE,
        accountName: "Loja Shopee",
        status: ConnectorStatus.REVOKED,
        lastSyncError: "app uninstalled",
      },
      {
        id: "acc-2",
        provider: ConnectorProvider.MERCADO_LIVRE,
        accountName: "Loja ML",
        status: ConnectorStatus.TOKEN_EXPIRED,
        lastSyncError: null,
      },
    ]);

    const drafts = await detectAccountQualityIssues("ws-1");

    expect(drafts).toHaveLength(2);
    expect(drafts[0].severity).toBe("critical");
    expect(drafts[1].severity).toBe("warning");
    expect(drafts[1].body).toContain("/connectors");
  });
});

describe("evaluateWorkspaceNotificationRules", () => {
  it("skips drafts on cooldown and persists the rest", async () => {
    prismaMocks.dailyMetric.groupBy.mockResolvedValue([]);
    prismaMocks.produto.findMany.mockResolvedValue([]);
    prismaMocks.connectorAccount.findMany.mockResolvedValue([
      {
        id: "acc-1",
        provider: ConnectorProvider.SHOPEE,
        accountName: "Loja Shopee",
        status: ConnectorStatus.ERROR,
        lastSyncError: "timeout",
      },
    ]);
    prismaMocks.notification.findFirst
      .mockResolvedValueOnce({ id: "recent" }) // acc-1 em cooldown
      .mockResolvedValue(null);
    txMocks.notification.findFirst
      .mockResolvedValueOnce({ id: "recent" })
      .mockResolvedValue(null);
    txMocks.notification.create.mockResolvedValue({});

    const created = await evaluateWorkspaceNotificationRules("ws-1");

    expect(created).toBe(0);
    expect(prismaMocks.notification.create).not.toHaveBeenCalled();
  });

  it("persiste o alerta de conta Shopee e herda o cooldown de 24h", async () => {
    prismaMocks.dailyMetric.groupBy.mockResolvedValue([]);
    prismaMocks.produto.findMany.mockResolvedValue([]);
    prismaMocks.connectorAccount.findMany.mockResolvedValue([]);

    detectShopeeAccountRoasDropMock.mockResolvedValue([
      {
        type: "roas_drop",
        severity: "warning",
        title: 'Queda de ROAS na conta "Loja"',
        entityType: "connector_account",
        entityId: "acc-shopee-1",
        metadata: { scope: "account" },
      },
    ]);
    txMocks.notification.create.mockResolvedValue({});

    const created = await evaluateWorkspaceNotificationRules("ws-1");

    expect(created).toBe(1);
    expect(txMocks.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "roas_drop",
          entityType: "connector_account",
          entityId: "acc-shopee-1",
        }),
      }),
    );

    // Segunda rodada dentro da janela de cooldown -> nada novo (ROAS-06).
    // O cooldown é lido em prisma (fora da tx) pelo isOnCooldown atual.
    prismaMocks.notification.findFirst.mockResolvedValueOnce({
      id: "recent",
    });
    const second = await evaluateWorkspaceNotificationRules("ws-1");
    expect(second).toBe(0);
  });

  it("nao derruba as demais regras quando a regra de conta falha", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      prismaMocks.dailyMetric.groupBy.mockResolvedValue([]);
      prismaMocks.produto.findMany.mockResolvedValue([]);
      prismaMocks.connectorAccount.findMany.mockResolvedValue([]);
      detectShopeeAccountRoasDropMock.mockRejectedValue(
        new Error("shopee exploded"),
      );
      txMocks.notification.create.mockResolvedValue({});

      await expect(evaluateWorkspaceNotificationRules("ws-1")).resolves.toBe(0);

      // Regra isolada: as outras rodaram e o erro foi logado.
      expect(txMocks.notification.create).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("shopee account rule failed"),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
