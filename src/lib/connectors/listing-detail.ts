/**
 * Detalhe canônico de um anúncio existente (Mercado Livre ou Shopee) para
 * IMPORTAR pro `Produto` do publisher e otimizar. Cada client normaliza a
 * resposta da sua API pra esta forma; o import-listings persiste no Produto.
 */
export type ListingDetail = {
  /** id do anúncio no marketplace (mlItemId / shopeeItemId). */
  externalId: string;
  title: string | null;
  description: string | null;
  /** category id do marketplace, como string (ML "MLB123" / Shopee numérico). */
  categoryId: string | null;
  price: number | null;
  availableQuantity: number | null;
  /** URLs das imagens do anúncio (capa = images[0]). */
  images: string[];
  /** Ficha técnica: { nome do atributo → valor }. */
  attributes: Record<string, string>;
};
