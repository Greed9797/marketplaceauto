import type { MercadoLivreInferredAttribute } from "@/lib/connectors/mercado-livre/client";
import type { RequiredAttribute } from "./category-attributes";

/**
 * Mapeia `produto.atributos` (Record keyed by nome, ex "Marca": "Apple") para o
 * formato de escrita de cada marketplace, casando enums pelo `value_id` real da
 * categoria — a correção central que faz o publish parar de ser rejeitado.
 * Enviar `value_name` cru para um atributo enumerado é justamente o que a API
 * recusa; aqui resolvemos o value_id quando a categoria enumera o valor.
 */

export type MlAttributePayload = {
  id: string;
  value_id?: string;
  value_name?: string;
};

export type ShopeeAttributePayload = {
  attribute_id: number;
  attribute_value_list: Array<{
    value_id?: number;
    original_value_name?: string;
    value_unit?: string;
  }>;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

/** Índice { normalizado → valor bruto } sobre as chaves do Record de atributos. */
function indexAtributos(
  atributos: Record<string, string> | null | undefined,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const [key, value] of Object.entries(atributos ?? {})) {
    const clean = typeof value === "string" ? value.trim() : "";
    if (clean) index.set(normalize(key), clean);
  }
  return index;
}

/** Valor preenchido para um atributo (busca por nome; fallback por id). */
function valueFor(
  attr: RequiredAttribute,
  index: Map<string, string>,
): string | null {
  return (
    index.get(normalize(attr.name)) ?? index.get(normalize(attr.id)) ?? null
  );
}

/** Casa um texto contra as opções enumeradas → option, ou null. */
function matchOption(attr: RequiredAttribute, value: string) {
  const target = normalize(value);
  return (
    attr.options?.find((opt) => normalize(opt.name) === target) ??
    attr.options?.find((opt) => opt.id && normalize(opt.id) === target) ??
    null
  );
}

/** Separa "128 GB" → { number: "128", unit: "GB" }. */
function splitNumberUnit(
  value: string,
  units: string[] | undefined,
): { number: string; unit: string | null } {
  const match = value.match(/^(-?\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!match) return { number: value.trim(), unit: units?.[0] ?? null };
  const unit = match[2].trim() || units?.[0] || null;
  return { number: match[1], unit };
}

/**
 * Monta o array `attributes` do POST /items. `inferred` traz value_id prontos do
 * domain_discovery (BRAND/MODEL) — usados quando o produto não preencheu o campo.
 */
export function buildMlAttributes(input: {
  atributos: Record<string, string> | null | undefined;
  required: RequiredAttribute[];
  inferred?: MercadoLivreInferredAttribute[];
}): MlAttributePayload[] {
  const index = indexAtributos(input.atributos);
  const inferredById = new Map(
    (input.inferred ?? []).map((a) => [a.id, a] as const),
  );
  const out: MlAttributePayload[] = [];

  for (const attr of input.required) {
    const value = valueFor(attr, index);

    if (!value) {
      // Sem valor do produto: aproveita o que o ML inferiu do título.
      const guess = inferredById.get(attr.id);
      if (guess?.value_id) out.push({ id: attr.id, value_id: guess.value_id });
      else if (guess?.value_name)
        out.push({ id: attr.id, value_name: guess.value_name });
      continue;
    }

    if (attr.type === "list" || attr.type === "boolean") {
      const option = matchOption(attr, value);
      if (option?.id) out.push({ id: attr.id, value_id: option.id });
      else if (attr.freeText) out.push({ id: attr.id, value_name: value });
      // enum fechado sem match → omite (gate/IA resolve; não manda lixo)
      continue;
    }

    if (attr.type === "number_unit") {
      const { number, unit } = splitNumberUnit(value, attr.units);
      out.push({
        id: attr.id,
        value_name: unit ? `${number} ${unit}` : number,
      });
      continue;
    }

    out.push({ id: attr.id, value_name: value });
  }

  return out;
}

/** Monta o array `attribute_list` do product/add_item. */
export function buildShopeeAttributes(input: {
  atributos: Record<string, string> | null | undefined;
  required: RequiredAttribute[];
}): ShopeeAttributePayload[] {
  const index = indexAtributos(input.atributos);
  const out: ShopeeAttributePayload[] = [];

  for (const attr of input.required) {
    const value = valueFor(attr, index);
    if (!value) continue;
    const attributeId = Number(attr.id);
    if (!Number.isFinite(attributeId)) continue;

    if (attr.type === "number_unit") {
      const { number, unit } = splitNumberUnit(value, attr.units);
      out.push({
        attribute_id: attributeId,
        attribute_value_list: [
          {
            value_id: 0,
            original_value_name: number,
            ...(unit ? { value_unit: unit } : {}),
          },
        ],
      });
      continue;
    }

    if (attr.type === "list" || attr.type === "boolean") {
      const option = matchOption(attr, value);
      if (option?.id && Number.isFinite(Number(option.id))) {
        out.push({
          attribute_id: attributeId,
          attribute_value_list: [
            { value_id: Number(option.id), original_value_name: option.name },
          ],
        });
      } else if (attr.freeText) {
        // COMBO custom: value_id 0 + texto.
        out.push({
          attribute_id: attributeId,
          attribute_value_list: [{ value_id: 0, original_value_name: value }],
        });
      }
      // DROP_DOWN sem match → omite.
      continue;
    }

    // Texto livre (TEXT_FILED): sem value_id.
    out.push({
      attribute_id: attributeId,
      attribute_value_list: [{ original_value_name: value }],
    });
  }

  return out;
}
