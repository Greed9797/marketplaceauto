/**
 * Score de qualidade de anúncio (0-100), determinístico e sem IA. Cada critério
 * dá pontos e uma dica acionável quando não está completo — a UI mostra o gauge
 * + o breakdown ("+10: adicione mais 2 imagens"). É a fonte da coluna `score` do
 * Produto (recalculado no save e no import).
 */

export type ScoreCriterion = {
  criterio: string;
  pontos: number;
  max: number;
  dica: string | null;
};

export type ListingScore = {
  score: number;
  breakdown: ScoreCriterion[];
};

/** Subconjunto do Produto que o score precisa (aceita o model Prisma inteiro). */
export type ScoreableProduto = {
  tituloMl?: string | null;
  tituloShopee?: string | null;
  descricao?: string | null;
  imagens?: string[] | null;
  fotoUrl?: string | null;
  atributos?: unknown;
  categoriaMlId?: string | null;
  categoriaShopeeId?: number | null;
  preco?: { toString(): string } | number | string | null;
  quantidade?: number | null;
};

/**
 * Requisitos REAIS resolvidos da categoria/marketplace (via previewPublish).
 * Sem isto o score é "não verificado" e NÃO pode chegar a 100 — evita enganar
 * o usuário com um anúncio que na verdade não publica.
 */
export type ScoreRequirements = {
  /** Nomes dos atributos obrigatórios da(s) categoria(s) conectada(s). */
  requiredAttrNames: string[];
  /** Gate real: todas as plataformas conectadas passam em validarPublicavel. */
  publicavel: boolean;
  /** Pendências humanizadas do gate (mensagens do que falta). */
  pendencias: string[];
};

// Comprimento ideal de título por marketplace (limites reais das APIs).
const TITULO_ML_MAX = 60;
const TITULO_SHOPEE_MAX = 120;
const DESCRICAO_MIN = 300;

function countImagens(produto: ScoreableProduto): number {
  const galeria = Array.isArray(produto.imagens) ? produto.imagens : [];
  const unicas = new Set(galeria.filter((url) => Boolean(url?.trim())));
  if (produto.fotoUrl?.trim()) unicas.add(produto.fotoUrl.trim());
  return unicas.size;
}

function atributosRecord(atributos: unknown): Record<string, string> {
  if (!atributos || typeof atributos !== "object" || Array.isArray(atributos)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(atributos as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) out[k] = s;
  }
  return out;
}

function toNumber(value: ScoreableProduto["preco"]): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

/** Melhor título disponível + o limite aplicável (ML é o mais restritivo). */
function tituloInfo(produto: ScoreableProduto): { texto: string; max: number } {
  const ml = produto.tituloMl?.trim() ?? "";
  const shopee = produto.tituloShopee?.trim() ?? "";
  if (ml) return { texto: ml, max: TITULO_ML_MAX };
  if (shopee) return { texto: shopee, max: TITULO_SHOPEE_MAX };
  return { texto: "", max: TITULO_ML_MAX };
}

export function calcularScore(
  produto: ScoreableProduto,
  requirements?: ScoreRequirements,
): ListingScore {
  const breakdown: ScoreCriterion[] = [];

  // Título: 8 por existir + comprimento ideal (>=20 chars e <= limite) 7.
  const { texto: titulo, max: tituloMax } = tituloInfo(produto);
  let pontosTitulo = 0;
  let dicaTitulo: string | null = null;
  if (titulo.length === 0) {
    dicaTitulo = "Preencha o título do anúncio";
  } else {
    pontosTitulo += 8;
    if (titulo.length >= 20 && titulo.length <= tituloMax) {
      pontosTitulo += 7;
    } else if (titulo.length < 20) {
      dicaTitulo =
        "Título curto: use ao menos 20 caracteres com palavras-chave";
    } else {
      dicaTitulo = `Título longo demais: reduza para até ${tituloMax} caracteres`;
    }
  }
  breakdown.push({
    criterio: "Título",
    pontos: pontosTitulo,
    max: 15,
    dica: dicaTitulo,
  });

  // Descrição: 15 se >= 300 chars; parcial 8 se tem algo.
  const descricao = produto.descricao?.trim() ?? "";
  let pontosDescricao = 0;
  let dicaDescricao: string | null = null;
  if (descricao.length >= DESCRICAO_MIN) {
    pontosDescricao = 15;
  } else if (descricao.length > 0) {
    pontosDescricao = 8;
    dicaDescricao = `Descrição curta: detalhe mais (mínimo ${DESCRICAO_MIN} caracteres)`;
  } else {
    dicaDescricao = "Adicione uma descrição completa do produto";
  }
  breakdown.push({
    criterio: "Descrição",
    pontos: pontosDescricao,
    max: 15,
    dica: dicaDescricao,
  });

  // Imagens: 8 por >=1, +7 por >=3.
  const nImagens = countImagens(produto);
  let pontosImagens = 0;
  let dicaImagens: string | null = null;
  if (nImagens >= 3) {
    pontosImagens = 15;
  } else if (nImagens >= 1) {
    pontosImagens = 8;
    dicaImagens = `Adicione mais ${3 - nImagens} imagem(ns) (ideal: 3+)`;
  } else {
    dicaImagens = "Adicione ao menos 1 imagem do produto";
  }
  breakdown.push({
    criterio: "Imagens",
    pontos: pontosImagens,
    max: 15,
    dica: dicaImagens,
  });

  // Atributos obrigatórios da categoria (25) — DADO REAL. Só pontua pela
  // cobertura dos atributos que a categoria de fato exige (via preview). Sem
  // esse dado (server/import), fica "não verificado" e no máximo parcial (15),
  // impedindo o 100 enganoso.
  const atributos = atributosRecord(produto.atributos);
  breakdown.push(criterioAtributos(atributos, requirements));

  // Publicável (20) — GATE REAL das plataformas conectadas. Sem o preview
  // (server), fica 0 com dica de onde validar — o 100 exige o gate verde.
  breakdown.push(criterioPublicavel(requirements));

  // Preço + estoque: 10 se preço > 0 e estoque > 0.
  const temPreco = toNumber(produto.preco) > 0;
  const temEstoque = (produto.quantidade ?? 0) > 0;
  let pontosPrecoEstoque = 0;
  let dicaPrecoEstoque: string | null = null;
  if (temPreco && temEstoque) {
    pontosPrecoEstoque = 10;
  } else if (!temPreco && !temEstoque) {
    dicaPrecoEstoque = "Defina preço e estoque";
  } else if (!temPreco) {
    dicaPrecoEstoque = "Defina o preço";
  } else {
    dicaPrecoEstoque = "Defina o estoque disponível";
  }
  breakdown.push({
    criterio: "Preço e estoque",
    pontos: pontosPrecoEstoque,
    max: 10,
    dica: dicaPrecoEstoque,
  });

  const score = breakdown.reduce((sum, c) => sum + c.pontos, 0);
  return { score, breakdown };
}

const MAX_ATRIBUTOS = 25;

/** Critério "Atributos obrigatórios" ancorado nos requisitos reais da categoria. */
function criterioAtributos(
  atributos: Record<string, string>,
  requirements?: ScoreRequirements,
): ScoreCriterion {
  const base = { criterio: "Atributos obrigatórios", max: MAX_ATRIBUTOS };

  if (!requirements) {
    // Não verificado: proporcional ao que existe, teto 15 (fica claro que
    // falta validar contra a categoria real).
    const n = Object.keys(atributos).length;
    const pontos = Math.min(15, n * 3);
    return {
      ...base,
      pontos,
      dica: "Abra a otimização com a loja conectada para validar os atributos exigidos pela categoria",
    };
  }

  const req = requirements.requiredAttrNames;
  if (req.length === 0) {
    // Categoria conhecida sem atributos obrigatórios → completo de fato.
    return { ...base, pontos: MAX_ATRIBUTOS, dica: null };
  }

  const preenchidos = req.filter((nome) =>
    Boolean(atributos[nome]?.trim()),
  ).length;
  const pontos = Math.round((MAX_ATRIBUTOS * preenchidos) / req.length);
  const faltando = req.filter((nome) => !atributos[nome]?.trim());
  return {
    ...base,
    pontos,
    dica:
      faltando.length === 0
        ? null
        : `Preencha os atributos exigidos: ${faltando.slice(0, 4).join(", ")}${faltando.length > 4 ? "…" : ""}`,
  };
}

const MAX_PUBLICAVEL = 20;

/** Critério "Pronto para publicar" — gate real; sem preview não pontua. */
function criterioPublicavel(requirements?: ScoreRequirements): ScoreCriterion {
  const base = { criterio: "Pronto para publicar", max: MAX_PUBLICAVEL };
  if (!requirements) {
    return {
      ...base,
      pontos: 0,
      dica: "Conecte a loja e abra a otimização para validar a publicação real",
    };
  }
  if (requirements.publicavel) {
    return { ...base, pontos: MAX_PUBLICAVEL, dica: null };
  }
  const pend = requirements.pendencias.slice(0, 3).join(" · ");
  return {
    ...base,
    pontos: 0,
    dica: pend
      ? `Resolva para publicar: ${pend}`
      : "Resolva as pendências de publicação",
  };
}
