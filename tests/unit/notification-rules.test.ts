import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMocks } = vi.hoisted(() => ({
  prismaMocks: {
    notification: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    dailyMetric: { groupBy: vi.fn() },
    produto: { findMany: vi.fn() },
    productInventory: { findMany: vi.fn() },
    connectorAccount: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMocks }));

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
    prismaMocks.notification.create.mockResolvedValue({});

    const created = await evaluateWorkspaceNotificationRules("ws-1");

    expect(created).toBe(0);
    expect(prismaMocks.notification.create).not.toHaveBeenCalled();
  });
});
