import { describe, expect, it } from "vitest";

import { buildMlAttributes, buildShopeeAttributes } from "./attribute-payload";
import type { RequiredAttribute } from "./category-attributes";

const mlBrand: RequiredAttribute = {
  id: "BRAND",
  name: "Marca",
  required: true,
  type: "list",
  freeText: false,
  options: [
    { id: "9344", name: "Apple" },
    { id: "58696", name: "Genérica" },
  ],
};
const mlModel: RequiredAttribute = {
  id: "MODEL",
  name: "Modelo",
  required: true,
  type: "string",
  freeText: true,
};
const mlMemory: RequiredAttribute = {
  id: "INTERNAL_MEMORY",
  name: "Memória interna",
  required: false,
  type: "number_unit",
  units: ["GB", "TB"],
  freeText: false,
};

describe("buildMlAttributes", () => {
  it("resolves enum value to value_id (not raw value_name)", () => {
    const out = buildMlAttributes({
      atributos: { Marca: "Apple", Modelo: "iPhone 13" },
      required: [mlBrand, mlModel],
    });
    expect(out).toContainEqual({ id: "BRAND", value_id: "9344" });
    expect(out).toContainEqual({ id: "MODEL", value_name: "iPhone 13" });
  });

  it("omits closed enum with no option match (never sends garbage)", () => {
    const out = buildMlAttributes({
      atributos: { Marca: "MarcaInexistente" },
      required: [mlBrand],
    });
    expect(out).toHaveLength(0);
  });

  it("falls back to inferred value_id when product field empty", () => {
    const out = buildMlAttributes({
      atributos: {},
      required: [mlBrand],
      inferred: [
        { id: "BRAND", name: "Marca", value_id: "9344", value_name: "Apple" },
      ],
    });
    expect(out).toEqual([{ id: "BRAND", value_id: "9344" }]);
  });

  it("number_unit keeps 'N UNIT' form", () => {
    const out = buildMlAttributes({
      atributos: { "Memória interna": "128 GB" },
      required: [mlMemory],
    });
    expect(out).toEqual([{ id: "INTERNAL_MEMORY", value_name: "128 GB" }]);
  });

  it("number_unit appends default unit when value has only a number", () => {
    const out = buildMlAttributes({
      atributos: { "Memória interna": "256" },
      required: [mlMemory],
    });
    expect(out).toEqual([{ id: "INTERNAL_MEMORY", value_name: "256 GB" }]);
  });
});

const shopeeBrand: RequiredAttribute = {
  id: "1001",
  name: "Marca",
  required: true,
  type: "list",
  freeText: false,
  options: [{ id: "2001", name: "Samsung" }],
};
const shopeeColorCombo: RequiredAttribute = {
  id: "1002",
  name: "Cor",
  required: false,
  type: "list",
  freeText: true,
  options: [{ id: "5", name: "Azul" }],
};
const shopeeVolume: RequiredAttribute = {
  id: "1003",
  name: "Volume",
  required: true,
  type: "number_unit",
  units: ["ml", "L"],
  freeText: false,
};

describe("buildShopeeAttributes", () => {
  it("enum → value_id (accent/case-insensitive match)", () => {
    const out = buildShopeeAttributes({
      atributos: { marca: "samsung" },
      required: [shopeeBrand],
    });
    expect(out).toEqual([
      {
        attribute_id: 1001,
        attribute_value_list: [
          { value_id: 2001, original_value_name: "Samsung" },
        ],
      },
    ]);
  });

  it("COMBO custom → value_id 0 + original_value_name", () => {
    const out = buildShopeeAttributes({
      atributos: { Cor: "Verde-limão" },
      required: [shopeeColorCombo],
    });
    expect(out).toEqual([
      {
        attribute_id: 1002,
        attribute_value_list: [
          { value_id: 0, original_value_name: "Verde-limão" },
        ],
      },
    ]);
  });

  it("QUANTITATIVE → number + value_unit", () => {
    const out = buildShopeeAttributes({
      atributos: { Volume: "500 ml" },
      required: [shopeeVolume],
    });
    expect(out).toEqual([
      {
        attribute_id: 1003,
        attribute_value_list: [
          { value_id: 0, original_value_name: "500", value_unit: "ml" },
        ],
      },
    ]);
  });

  it("skips attributes with no product value", () => {
    const out = buildShopeeAttributes({
      atributos: {},
      required: [shopeeBrand],
    });
    expect(out).toHaveLength(0);
  });
});
