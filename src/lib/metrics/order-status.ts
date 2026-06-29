const APPROVED_TERMS: ReadonlyArray<string> = [
  // Payment received — the canonical "Recebido" and its aliases across all
  // platforms (Nuvemshop "paid", Shopify "PAID", WBuy "Pagamento efetuado",
  // PT-BR "Recebido/Recebida", manual "APPROVED").
  "approved",
  "aprovado",
  "paid",
  "pago",
  "recebid", // recebido / recebida / recebidos / recebidas
  "efetuado", // WBuy "Pagamento efetuado"
  "captured",
  "settled",
  "completed",
  "complete",
  "concluido",
  "finalizado",
  "faturado",
  "entregue", // delivered order is a terminal, paid sale
  "delivered",
];
// NOTE: fulfillment-progress states (producao/expedicao/separacao/enviado/
// postado/transito/transporte/shipped) are intentionally NOT here. Per product
// rule "Recebido = pagamento recebido, nada a ver com entrega", a fulfillment
// state does not by itself confirm payment — connectors must emit an explicit
// payment term at ingestion. Counting "em separação" as paid inflated GMV.

const REJECTED_TERMS: ReadonlyArray<string> = [
  "abandoned",
  "cancel",
  "cancelado",
  "canceled",
  "chargeback",
  "declined",
  "denied",
  "negado", // WBuy "Pagamento negado"
  "devolvido",
  "disputed",
  "estornado",
  "refund",
  "refunded",
  "reembolsado",
  "void",
  "failed",
  "falhou",
  "refused",
  "recusado",
  "unpaid",
  "pending",
  "pendente",
  "aguardando",
  "aberto",
  "authorized",
  "autorizado",
];

// WBuy only ever advances an order INTO these fulfillment states AFTER payment
// is confirmed (you don't produce/separate/ship an unpaid order), so for WBuy
// they are paid sales — unlike the generic rule, where a fulfillment state does
// not by itself prove payment. Scoped to WBuy via the `provider` argument.
const WBUY_PAID_FULFILLMENT_TERMS: ReadonlyArray<string> = [
  "producao", // Em produção
  "expedicao", // Em expedição
  "separacao", // Em separação
  "transporte",
  "transito",
  "enviado",
  "postado",
];

const DIACRITICS_RE = /[̀-ͯ]/g;

export function isApprovedOrderStatus(
  status: string | null | undefined,
  provider?: string | null,
): boolean {
  const raw = status?.trim();
  if (!raw) {
    // Unknown/empty status is NOT an approved sale. Counting it as approved
    // silently inflated GMV with unprocessed orders. Connectors that genuinely
    // have a confirmed sale must emit an explicit approved term at ingestion
    // (Shopify → financial status, manual commerce → "APPROVED", iSET →
    // "paid"); a bare null must never reach revenue.
    return false;
  }

  const normalized = raw
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase();

  if (REJECTED_TERMS.some((term) => normalized.includes(term))) {
    return false;
  }

  // WBuy: a fulfillment state implies the order was already paid.
  if (
    provider === "WBUY" &&
    WBUY_PAID_FULFILLMENT_TERMS.some((term) => normalized.includes(term))
  ) {
    return true;
  }

  return APPROVED_TERMS.some((term) => normalized.includes(term));
}
