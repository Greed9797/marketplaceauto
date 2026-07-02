import { describe, expect, it } from "vitest";
import { ConnectorProvider } from "@prisma/client";

import {
  mapEcommerceOrderToRecord,
  partitionOrdersForPersist,
} from "@/lib/connectors/ecommerce-sync";
import type { ShopifyOrder } from "@/lib/connectors/shopify/client";

const base: ShopifyOrder = {
  externalOrderId: "1",
  orderNumber: null,
  orderTotal: "10.00",
  orderCurrency: "BRL",
  customerEmail: null,
  itemsCount: 0,
  status: "paid",
  placedAt: "2026-07-02T09:00:00Z",
};

describe("mapEcommerceOrderToRecord", () => {
  it("maps orderCreatedAt to a Date and keeps null when absent", () => {
    const withCreated = mapEcommerceOrderToRecord({
      workspaceId: "w",
      connectorAccountId: "c",
      provider: ConnectorProvider.NUVEMSHOP,
      order: { ...base, orderCreatedAt: "2026-06-15T10:00:00Z" },
    });
    expect(withCreated?.orderCreatedAt?.toISOString()).toBe(
      "2026-06-15T10:00:00.000Z",
    );
    expect(withCreated?.placedAt.toISOString()).toBe(
      "2026-07-02T09:00:00.000Z",
    );

    const withoutCreated = mapEcommerceOrderToRecord({
      workspaceId: "w",
      connectorAccountId: "c",
      provider: ConnectorProvider.NUVEMSHOP,
      order: base,
    });
    expect(withoutCreated?.orderCreatedAt).toBeNull();
  });
});

describe("partitionOrdersForPersist", () => {
  it("keeps valid-date orders and counts invalid-placedAt skips", () => {
    const { valid, skippedInvalidDate } = partitionOrdersForPersist({
      workspaceId: "w",
      connectorAccountId: "c",
      provider: ConnectorProvider.NUVEMSHOP,
      orders: [base, { ...base, externalOrderId: "2", placedAt: "" }],
    });
    expect(valid).toHaveLength(1);
    expect(valid[0].order.externalOrderId).toBe("1");
    expect(skippedInvalidDate).toBe(1);
  });
});
