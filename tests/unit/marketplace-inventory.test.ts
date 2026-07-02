import { describe, expect, test } from "vitest";

import { normalizeMercadoLivreInventoryItem } from "@/lib/connectors/mercado-livre/client";
import {
  normalizeShopeeInventoryItem,
  normalizeShopeeOrder,
} from "@/lib/connectors/shopee/client";

describe("normalizeMercadoLivreInventoryItem", () => {
  test("maps multiget body to an inventory row", () => {
    const row = normalizeMercadoLivreInventoryItem({
      id: "MLB123",
      title: "Furadeira 500W",
      available_quantity: 37,
      category_id: "MLB263532",
      status: "active",
      seller_custom_field: "FUR-500",
    });
    expect(row).toEqual({
      externalProductId: "MLB123",
      sku: "FUR-500",
      productName: "Furadeira 500W",
      categoryName: null,
      quantity: 37,
    });
  });

  test("skips closed listings and null bodies", () => {
    expect(
      normalizeMercadoLivreInventoryItem({ id: "MLB9", status: "closed" }),
    ).toBeNull();
    expect(normalizeMercadoLivreInventoryItem(null)).toBeNull();
  });

  test("missing stock becomes null (não zero)", () => {
    const row = normalizeMercadoLivreInventoryItem({
      id: "MLB77",
      title: "Item",
      status: "active",
    });
    expect(row?.quantity).toBeNull();
  });
});

describe("normalizeShopeeInventoryItem", () => {
  test("maps base_info item with stock summary and category name", () => {
    const row = normalizeShopeeInventoryItem(
      {
        item_id: 4455,
        item_name: "Camiseta Oversized",
        item_sku: "CAM-OV",
        category_id: 100001,
        stock_info_v2: { summary_info: { total_available_stock: 12 } },
      },
      new Map([[100001, "Roupas Masculinas"]]),
    );
    expect(row).toEqual({
      externalProductId: "4455",
      sku: "CAM-OV",
      productName: "Camiseta Oversized",
      categoryName: "Roupas Masculinas",
      quantity: 12,
    });
  });

  test("unknown category and missing stock stay null", () => {
    const row = normalizeShopeeInventoryItem(
      { item_id: 9, item_name: "X" },
      new Map(),
    );
    expect(row?.categoryName).toBeNull();
    expect(row?.quantity).toBeNull();
  });
});

describe("shippingState capture", () => {
  test("Shopee order carries recipient_address.state (region é o país, não o estado)", () => {
    const order = normalizeShopeeOrder({
      order_sn: "BR123",
      order_status: "COMPLETED",
      create_time: 1751400000,
      recipient_address: { state: "Santa Catarina", region: "BR" },
    });
    expect(order.shippingState).toBe("Santa Catarina");
    expect(order.status).toBe("paid");
  });

  test("Shopee order without recipient_address keeps null", () => {
    const order = normalizeShopeeOrder({
      order_sn: "BR124",
      order_status: "READY_TO_SHIP",
      create_time: 1751400000,
    });
    expect(order.shippingState).toBeNull();
  });
});
