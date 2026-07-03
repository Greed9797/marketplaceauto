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

function countAtributos(atributos: unknown): number {
  if (!atributos || typeof atributos !== "object" || Array.isArray(atributos)) {
    return 0;
  }
  return Object.values(atributos as Record<string, unknown>).filter((v) => {
    if (v === null || v === undefined) return false;
    return String(v).trim().length > 0;
  }).length;
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

export function calcularScore(produto: ScoreableProduto): ListingScore {
  const breakdown: ScoreCriterion[] = [];

  // Título: 12 por existir + comprimento ideal (>=20 chars e <= limite) 8.
  const { texto: titulo, max: tituloMax } = tituloInfo(produto);
  let pontosTitulo = 0;
  let dicaTitulo: string | null = null;
  if (titulo.length === 0) {
    dicaTitulo = "Preencha o título do anúncio";
  } else {
    pontosTitulo += 12;
    if (titulo.length >= 20 && titulo.length <= tituloMax) {
      pontosTitulo += 8;
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
    max: 20,
    dica: dicaTitulo,
  });

  // Descrição: 20 se >= 300 chars; parcial 10 se tem algo.
  const descricao = produto.descricao?.trim() ?? "";
  let pontosDescricao = 0;
  let dicaDescricao: string | null = null;
  if (descricao.length >= DESCRICAO_MIN) {
    pontosDescricao = 20;
  } else if (descricao.length > 0) {
    pontosDescricao = 10;
    dicaDescricao = `Descrição curta: detalhe mais (mínimo ${DESCRICAO_MIN} caracteres)`;
  } else {
    dicaDescricao = "Adicione uma descrição completa do produto";
  }
  breakdown.push({
    criterio: "Descrição",
    pontos: pontosDescricao,
    max: 20,
    dica: dicaDescricao,
  });

  // Imagens: 10 por >=1, +10 por >=3.
  const nImagens = countImagens(produto);
  let pontosImagens = 0;
  let dicaImagens: string | null = null;
  if (nImagens >= 3) {
    pontosImagens = 20;
  } else if (nImagens >= 1) {
    pontosImagens = 10;
    dicaImagens = `Adicione mais ${3 - nImagens} imagem(ns) (ideal: 3+)`;
  } else {
    dicaImagens = "Adicione ao menos 1 imagem do produto";
  }
  breakdown.push({
    criterio: "Imagens",
    pontos: pontosImagens,
    max: 20,
    dica: dicaImagens,
  });

  // Ficha técnica / atributos: 20 se >=5 campos; parcial proporcional.
  const nAtributos = countAtributos(produto.atributos);
  let pontosAtributos = 0;
  let dicaAtributos: string | null = null;
  if (nAtributos >= 5) {
    pontosAtributos = 20;
  } else if (nAtributos > 0) {
    pontosAtributos = nAtributos * 4;
    dicaAtributos = `Preencha mais ${5 - nAtributos} atributo(s) da ficha técnica`;
  } else {
    dicaAtributos = "Preencha a ficha técnica (marca, material, tamanho...)";
  }
  breakdown.push({
    criterio: "Ficha técnica",
    pontos: pontosAtributos,
    max: 20,
    dica: dicaAtributos,
  });

  // Categoria: 10 se ML ou Shopee definida.
  const temCategoria =
    Boolean(produto.categoriaMlId?.trim()) ||
    (produto.categoriaShopeeId ?? 0) > 0;
  breakdown.push({
    criterio: "Categoria",
    pontos: temCategoria ? 10 : 0,
    max: 10,
    dica: temCategoria ? null : "Defina a categoria do anúncio",
  });

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
