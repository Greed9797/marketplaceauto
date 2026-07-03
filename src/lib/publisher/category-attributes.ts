import type {
  MercadoLivreCategoryAttribute,
  MercadoLivreClient,
} from "@/lib/connectors/mercado-livre/client";
import type {
  ShopeeCategoryAttribute,
  ShopeeClient,
} from "@/lib/connectors/shopee/client";

/**
 * Forma canônica de um atributo de categoria, agnóstica de marketplace. É o que
 * a IA (Fase 1.4), o gate de validação (Fase 1.5) e a UI (Fase 1.7) consomem —
 * elas não devem conhecer os shapes crus de ML/Shopee.
 */
export type AttributeValueType =
  | "string"
  | "number"
  | "list"
  | "boolean"
  | "number_unit";

export interface AttributeOption {
  id: string;
  name: string;
}

export interface RequiredAttribute {
  /** ML: attr.id ("BRAND"); Shopee: String(attribute_id). */
  id: string;
  name: string;
  required: boolean;
  type: AttributeValueType;
  /** Valores enumerados (list/boolean). */
  options?: AttributeOption[];
  /** Unidades permitidas (number_unit). */
  units?: string[];
  /** true = aceita valor de texto livre além (ou no lugar) do enum. */
  freeText: boolean;
}

export type Platform = "ml" | "shopee";

const ML_VALUE_TYPES: ReadonlySet<AttributeValueType> = new Set([
  "string",
  "number",
  "list",
  "boolean",
  "number_unit",
]);

/** Normaliza atributos crus do Mercado Livre → forma canônica. */
export function normalizeMlAttributes(
  raw: MercadoLivreCategoryAttribute[],
): RequiredAttribute[] {
  return raw
    .filter((attr) => Boolean(attr?.id))
    .map((attr) => {
      const rawType = attr.value_type?.toLowerCase() ?? "string";
      const type: AttributeValueType = ML_VALUE_TYPES.has(
        rawType as AttributeValueType,
      )
        ? (rawType as AttributeValueType)
        : "string";
      const options = (attr.values ?? [])
        .filter((v): v is { id?: string | null; name?: string | null } =>
          Boolean(v?.name),
        )
        .map((v) => ({ id: v.id?.trim() || "", name: v.name!.trim() }));
      return {
        id: attr.id,
        name: attr.name?.trim() || attr.id,
        required: attr.tags?.required === true,
        type,
        options: options.length ? options : undefined,
        units: attr.allowed_units?.length
          ? attr.allowed_units
              .map((u) => u.id?.trim() || u.name?.trim() || "")
              .filter(Boolean)
          : undefined,
        // ML: string sem values aceita texto livre; list/boolean são fechados.
        freeText: type === "string" || type === "number",
      };
    });
}

/** Mapeia input_type/format_type da Shopee → tipo canônico + flag freeText. */
function shopeeTypeFor(attr: ShopeeCategoryAttribute): {
  type: AttributeValueType;
  freeText: boolean;
} {
  if (attr.format_type === "QUANTITATIVE") {
    return { type: "number_unit", freeText: false };
  }
  switch (attr.input_type) {
    case "DROP_DOWN":
    case "MULTIPLE_SELECT":
      return { type: "list", freeText: false };
    case "COMBO_BOX":
    case "MULTIPLE_SELECT_COMBO_BOX":
      return { type: "list", freeText: true };
    case "TEXT_FILED":
    default: {
      const numeric =
        attr.input_validation_type === "INT_TYPE" ||
        attr.input_validation_type === "FLOAT_TYPE";
      return { type: numeric ? "number" : "string", freeText: true };
    }
  }
}

/** Normaliza atributos crus da Shopee → forma canônica. */
export function normalizeShopeeAttributes(
  raw: ShopeeCategoryAttribute[],
): RequiredAttribute[] {
  return raw
    .filter((attr) => Number.isFinite(attr?.attribute_id))
    .map((attr) => {
      const { type, freeText } = shopeeTypeFor(attr);
      const options = (attr.attribute_value_list ?? [])
        .filter((v) => Boolean(v?.original_value_name || v?.display_value_name))
        .map((v) => ({
          id: v.value_id != null ? String(v.value_id) : "",
          name: (v.original_value_name || v.display_value_name || "").trim(),
        }));
      return {
        id: String(attr.attribute_id),
        name:
          attr.original_attribute_name?.trim() ||
          attr.display_attribute_name?.trim() ||
          String(attr.attribute_id),
        required: attr.is_mandatory === true,
        type,
        options: options.length ? options : undefined,
        units: attr.attribute_unit_list?.length
          ? attr.attribute_unit_list.filter(Boolean)
          : undefined,
        freeText,
      };
    });
}

/**
 * Resolve os atributos canônicos de uma categoria pelo client apropriado.
 * ML: endpoint público (sem token). Shopee: precisa token + shopId da conta.
 */
export async function getRequiredAttributes(
  input:
    | { platform: "ml"; client: MercadoLivreClient; categoryId: string }
    | {
        platform: "shopee";
        client: ShopeeClient;
        categoryId: number;
        accessToken: string;
        shopId: number;
      },
): Promise<RequiredAttribute[]> {
  if (input.platform === "ml") {
    const raw = await input.client.fetchCategoryAttributes(input.categoryId);
    return normalizeMlAttributes(raw);
  }
  const raw = await input.client.fetchCategoryAttributes({
    categoryId: input.categoryId,
    accessToken: input.accessToken,
    shopId: input.shopId,
  });
  return normalizeShopeeAttributes(raw);
}
