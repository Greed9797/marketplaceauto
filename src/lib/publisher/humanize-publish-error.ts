/**
 * Traduz um erro cru de publicação (texto da API ML/Shopee, corpo HTTP 400,
 * fragmento de stack) em algo acionável em pt-BR — espelha `humanize-sync-error`
 * mas para o fluxo de publish. `detail` guarda o original para suporte.
 */
export type FriendlyPublishError = {
  title: string;
  action: string;
  detail: string;
};

type Rule = {
  match: RegExp;
  title: string;
  action: string;
};

// Primeira regra que casa vence — do mais específico ao mais genérico.
const RULES: ReadonlyArray<Rule> = [
  {
    match:
      /required attribute|atributo obrigat|missing.*attribute|attribute.*required|is_mandatory/i,
    title: "Falta um atributo obrigatório",
    action:
      "A categoria exige um atributo que não foi preenchido. Complete a ficha técnica e publique de novo.",
  },
  {
    match: /gtin|ean|c[oó]digo universal|barcode/i,
    title: "Código GTIN/EAN inválido",
    action:
      "Informe um GTIN/EAN válido ou marque o produto como sem código universal na ficha.",
  },
  {
    match:
      /not a leaf|categoria.*folha|leaf category|invalid category|category.*not|categoria inv/i,
    title: "Categoria inválida",
    action:
      "Escolha uma categoria final (folha) — categorias com subcategorias não aceitam anúncio.",
  },
  {
    match: /image|imagem|picture|foto/i,
    title: "Problema com as imagens",
    action:
      "Adicione ao menos uma imagem com URL pública e tente publicar novamente.",
  },
  {
    match: /\bprice\b|pre[cç]o|original_price|valor/i,
    title: "Preço inválido",
    action: "Defina um preço maior que zero antes de publicar.",
  },
  {
    match: /stock|estoque|quantity|available_quantity|seller_stock/i,
    title: "Estoque inválido",
    action: "Defina um estoque maior que zero antes de publicar.",
  },
  {
    match: /weight|peso|dimension|dimens[aã]o|package_/i,
    title: "Peso ou dimensões faltando",
    action:
      "Informe peso e dimensões da embalagem — a Shopee exige para calcular o frete.",
  },
  {
    match: /logistic|log[ií]stica|shipping channel|canal de envio/i,
    title: "Sem logística ativa",
    action:
      "Ative ao menos um canal de envio na sua loja Shopee e tente novamente.",
  },
  {
    match: /token|expired|unauthorized|\b401\b|reconecte|invalid_grant/i,
    title: "Conexão expirada",
    action:
      "A conexão com o marketplace expirou. Reconecte a conta e publique de novo.",
  },
  {
    match: /\b429\b|rate limit|too many requests/i,
    title: "Muitas requisições",
    action:
      "O marketplace limitou temporariamente. Aguarde um minuto e tente de novo.",
  },
];

/** Extrai a parte útil de um corpo de erro ML (`cause[].message`) quando houver. */
function extractMlCause(detail: string): string | null {
  try {
    const parsed = JSON.parse(detail) as {
      cause?: Array<{ message?: string; code?: string }>;
      message?: string;
    };
    const causes = (parsed.cause ?? [])
      .map((c) => c?.message?.trim())
      .filter(Boolean);
    if (causes.length) return causes.join(" · ");
    return parsed.message?.trim() || null;
  } catch {
    return null;
  }
}

export function humanizePublishError(
  raw: string | null | undefined,
): FriendlyPublishError {
  const detail = (raw ?? "").toString().trim() || "Erro desconhecido.";
  const haystack = extractMlCause(detail) ?? detail;

  for (const rule of RULES) {
    if (rule.match.test(haystack)) {
      return { title: rule.title, action: rule.action, detail };
    }
  }

  return {
    title: "Falha ao publicar",
    action:
      "Não foi possível publicar o anúncio. Revise os dados do produto e tente novamente.",
    detail,
  };
}
