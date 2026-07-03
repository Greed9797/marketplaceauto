import { describe, expect, it } from "vitest";

import {
  normalizeMlAttributes,
  normalizeShopeeAttributes,
} from "./category-attributes";

describe("normalizeMlAttributes", () => {
  it("marks tags.required===true as required and keeps enum values", () => {
    const [carrier] = normalizeMlAttributes([
      {
        id: "CARRIER",
        name: "Operadora",
        value_type: "list",
        tags: { required: true },
        values: [
          { id: "298335", name: "Desbloqueado" },
          { id: "298333", name: "Claro" },
        ],
      },
    ]);
    expect(carrier.required).toBe(true);
    expect(carrier.type).toBe("list");
    expect(carrier.freeText).toBe(false);
    expect(carrier.options).toEqual([
      { id: "298335", name: "Desbloqueado" },
      { id: "298333", name: "Claro" },
    ]);
  });

  it("treats absent/other tags as not required and number_unit keeps units", () => {
    const [mem] = normalizeMlAttributes([
      {
        id: "INTERNAL_MEMORY",
        name: "Memória interna",
        value_type: "number_unit",
        tags: {},
        allowed_units: [
          { id: "GB", name: "GB" },
          { id: "TB", name: "TB" },
        ],
        default_unit: "GB",
      },
    ]);
    expect(mem.required).toBe(false);
    expect(mem.type).toBe("number_unit");
    expect(mem.units).toEqual(["GB", "TB"]);
  });

  it("free-text string attribute accepts custom values", () => {
    const [model] = normalizeMlAttributes([
      {
        id: "MODEL",
        name: "Modelo",
        value_type: "string",
        tags: { required: true },
      },
    ]);
    expect(model.freeText).toBe(true);
    expect(model.options).toBeUndefined();
  });
});

describe("normalizeShopeeAttributes", () => {
  it("DROP_DOWN is a closed enum; is_mandatory drives required", () => {
    const [brand] = normalizeShopeeAttributes([
      {
        attribute_id: 1001,
        original_attribute_name: "Marca",
        is_mandatory: true,
        input_type: "DROP_DOWN",
        input_validation_type: "ENUM_TYPE",
        format_type: "NORMAL",
        attribute_value_list: [
          { value_id: 2001, original_value_name: "Samsung" },
        ],
      },
    ]);
    expect(brand.id).toBe("1001");
    expect(brand.required).toBe(true);
    expect(brand.type).toBe("list");
    expect(brand.freeText).toBe(false);
    expect(brand.options).toEqual([{ id: "2001", name: "Samsung" }]);
  });

  it("COMBO_BOX allows custom text alongside enum", () => {
    const [combo] = normalizeShopeeAttributes([
      {
        attribute_id: 1002,
        original_attribute_name: "Cor",
        is_mandatory: false,
        input_type: "COMBO_BOX",
        format_type: "NORMAL",
        attribute_value_list: [{ value_id: 5, original_value_name: "Azul" }],
      },
    ]);
    expect(combo.freeText).toBe(true);
    expect(combo.type).toBe("list");
  });

  it("QUANTITATIVE becomes number_unit with units", () => {
    const [vol] = normalizeShopeeAttributes([
      {
        attribute_id: 1003,
        original_attribute_name: "Volume",
        is_mandatory: true,
        input_type: "TEXT_FILED",
        format_type: "QUANTITATIVE",
        attribute_unit_list: ["ml", "L"],
      },
    ]);
    expect(vol.type).toBe("number_unit");
    expect(vol.units).toEqual(["ml", "L"]);
  });

  it("TEXT_FILED plain is free-text string", () => {
    const [desc] = normalizeShopeeAttributes([
      {
        attribute_id: 1004,
        original_attribute_name: "Material",
        is_mandatory: false,
        input_type: "TEXT_FILED",
        input_validation_type: "STRING_TYPE",
        format_type: "NORMAL",
      },
    ]);
    expect(desc.type).toBe("string");
    expect(desc.freeText).toBe(true);
  });
});
