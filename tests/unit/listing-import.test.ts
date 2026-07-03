import { describe, expect, test } from "vitest";

import { normalizeMercadoLivreListing } from "@/lib/connectors/mercado-livre/client";
import { normalizeShopeeListing } from "@/lib/connectors/shopee/client";

describe("normalizeMercadoLivreListing", () => {
  test("mapeia pictures, attributes, price e description", () => {
    const detail = normalizeMercadoLivreListing(
      {
        id: "MLB123",
        title: "Kit 5 Leggings",
        category_id: "MLB1234",
        price: 79.9,
        available_quantity: 10,
        status: "active",
        pictures: [
          { secure_url: "https://a.jpg", url: "http://a.jpg" },
          { url: "http://b.jpg" },
        ],
        attributes: [
          { name: "Marca", value_name: "W3" },
          { name: "Material", value_name: "Algodão" },
          { name: "Vazio", value_name: null },
        ],
      },
      "Descrição completa do produto",
    );
    expect(detail).toEqual({
      externalId: "MLB123",
      title: "Kit 5 Leggings",
      description: "Descrição completa do produto",
      categoryId: "MLB1234",
      price: 79.9,
      availableQuantity: 10,
      images: ["https://a.jpg", "http://b.jpg"],
      attributes: { Marca: "W3", Material: "Algodão" },
    });
  });
});

describe("normalizeShopeeListing", () => {
  test("mapeia image_url_list, attribute_list, price_info e description", () => {
    const detail = normalizeShopeeListing({
      item_id: 4455,
      item_name: "Camiseta",
      category_id: 100123,
      item_status: "NORMAL",
      description: "Camiseta premium",
      image: { image_url_list: ["https://x.jpg", "https://y.jpg", null] },
      price_info: [{ current_price: 49.9, original_price: 59.9 }],
      stock_info_v2: { summary_info: { total_available_stock: 8 } },
      attribute_list: [
        {
          original_attribute_name: "Cor",
          attribute_value_list: [{ value_name: "Azul" }],
        },
      ],
    });
    expect(detail).toEqual({
      externalId: "4455",
      title: "Camiseta",
      description: "Camiseta premium",
      categoryId: "100123",
      price: 49.9,
      availableQuantity: 8,
      images: ["https://x.jpg", "https://y.jpg"],
      attributes: { Cor: "Azul" },
    });
  });
});
