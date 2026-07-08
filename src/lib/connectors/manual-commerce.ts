import { ConnectorProvider } from "@prisma/client";

import type { ShopifyOrder } from "@/lib/connectors/shopify/client";

export type ManualProviderCredentials = {
  provider: ConnectorProvider;
  storeName: string;
  baseUrl: string;
  apiKey?: string;
  apiSecret?: string;
  apiUser?: string;
  apiPassword?: string;
};

export type ManualCommerceOrderPayload = Record<string, unknown>;

function asString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  return String(value);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

/**
 * Some providers nest the order total in an object (WBuy:
 * `valor_total: { total, subtotal, frete, ... }`). Pull a usable amount from
 * the object, else treat the value as a scalar.
 */
function moneyFromMaybeObject(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    return firstString(o.total, o.valor, o.value, o.amount, o.subtotal);
  }

  return asString(value);
}

/**
 * Some providers send status as an object (WBuy: `status: { id, nome }`).
 * Extract the human label, else treat as a scalar.
 */
function statusFromMaybeObject(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    return firstString(o.nome, o.name, o.status, o.descricao, o.label);
  }

  return asString(value);
}

/**
 * Loja Integrada (Django Tastypie) exposes the order status as a FK that can
 * arrive in three shapes depending on the endpoint/expansion:
 *   - a numeric code (`situacao: 4` / `situacao_id: 4`)
 *   - a resource URI (`"/api/v1/situacao/4/"`)
 *   - an expanded object (`{ codigo: 4, nome: "Pago" }`)
 * A bare URI or code would otherwise reach the revenue filter as a non-matching
 * string and silently drop the sale. We map the known LI status codes to a PT
 * term the downstream `isApprovedOrderStatus` filter understands. Returns null
 * for an unrecognized/absent value so the caller can fall back to the object's
 * `nome` (handled via statusFromMaybeObject).
 *
 * Code semantics (LI order states): 2=aguardando, 3=em análise, 4=pago,
 * 6=disputa, 7=devolvido, 8=cancelado, 9=efetuado (placed, NOT paid),
 * 11=enviado, 13=pronto p/ retirada, 14=entregue.
 */
function lojaIntegradaSituacaoLabel(value: unknown): string | null {
  let code: string | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    code = String(value);
  } else if (typeof value === "string") {
    const fromUri = value.match(/situacao\/(\d+)/);
    code = fromUri
      ? fromUri[1]
      : /^\d+$/.test(value.trim())
        ? value.trim()
        : null;
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    code = firstString(o.codigo, o.id);
    // Already an expanded object with a human label → let it flow through the
    // normal name path instead of code-mapping.
    if (firstString(o.nome, o.name)) {
      return null;
    }
  }
  if (!code) {
    return null;
  }
  // Loja Integrada situacao codes → canonical PAYMENT term. This is the
  // per-platform normalization layer: in LI, codes 11/13/14 only occur AFTER
  // payment (shipped / picking / delivered), so they map to "pago" and count as
  // revenue. Code 9 ("Pedido efetuado") is placed-but-not-paid, so it maps to a
  // pending term — NOT "efetuado", which the shared APPROVED_TERMS still treats
  // as paid for WBuy ("Pagamento efetuado"). Keeping them distinct avoids the
  // cross-platform collision that counted unpaid LI orders as revenue.
  const LABELS: Record<string, string> = {
    "2": "aguardando",
    "3": "pendente",
    "4": "pago",
    "6": "disputed",
    "7": "estornado",
    "8": "cancelado",
    "9": "pendente", // "Pedido efetuado" = placed, not paid
    "11": "pago", // shipped — only happens post-payment in LI
    "13": "pago", // em separação — post-payment
    "14": "entregue", // delivered — terminal paid state
  };
  return LABELS[code] ?? null;
}

function normalizeMoney(value: string | null) {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/[^\d,.-]/g, "");
  if (
    cleaned.includes(",") &&
    cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
  ) {
    return cleaned.replace(/\./g, "").replace(",", ".");
  }

  return cleaned;
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withProtocol);

  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

export function normalizeManualProviderCredentials(
  input: ManualProviderCredentials,
) {
  return {
    provider: input.provider,
    storeName: input.storeName.trim(),
    baseUrl:
      input.provider === ConnectorProvider.GOOGLE_SHEETS
        ? input.baseUrl.trim()
        : normalizeBaseUrl(input.baseUrl),
    apiKey: input.apiKey?.trim() || undefined,
    apiSecret: input.apiSecret?.trim() || undefined,
    apiUser: input.apiUser?.trim() || undefined,
    apiPassword: input.apiPassword?.trim() || undefined,
  };
}

function sumItemsCount(value: unknown) {
  if (!Array.isArray(value)) {
    return 0;
  }

  return value.reduce((sum, item) => {
    if (!item || typeof item !== "object") {
      return sum;
    }

    const record = item as Record<string, unknown>;
    const quantity = Number(
      record.quantidade ?? record.quantity ?? record.qtd ?? 1,
    );

    return sum + (Number.isFinite(quantity) ? quantity : 1);
  }, 0);
}

function firstFiniteInteger(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    const parsed = Number(String(value).replace(/[^\d-]/g, ""));
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }

  return null;
}

function normalizeItems(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const quantity = Number(
      record.quantidade ?? record.quantity ?? record.qtd ?? 1,
    );

    return [
      {
        productName:
          firstString(
            record.nome,
            record.name,
            record.product_name,
            record.title,
          ) ?? `Produto ${index + 1}`,
        sku: firstString(record.sku, record.codigo_sku, record.reference),
        quantity: Number.isFinite(quantity) ? quantity : 1,
        total: firstString(
          record.total,
          record.valor_total,
          record.price,
          record.preco,
        ),
      },
    ];
  });
}

// Magazord v2 (`/api/v2/site/pedido`) stamps dates as "YYYY-MM-DD HH:mm:ss-03"
// (space separator, offset without minutes) — Date.parse rejects it, so convert
// to ISO here or every Magazord order is skipped by the parsePlacedAt guard.
function magazordIsoDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  let candidate = value.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(candidate)) {
    candidate += ":00";
  }
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

// Magazord situação -> canonical status. `pedidoSituacaoTipo` 3 = cancelado;
// everything past payment approval (Transporte, Entregue, Crédito Aprovado…)
// counts as paid — Magazord only advances an order after payment clears.
// Validated against the live distribution of the Br Artes store.
function magazordStatusLabel(payload: ManualCommerceOrderPayload) {
  const desc = payload.pedidoSituacaoDescricao;
  const tipo = payload.pedidoSituacaoTipo;
  if (desc === undefined && tipo === undefined) {
    return undefined;
  }
  const label = String(desc ?? "").toLowerCase();
  if (Number(tipo) === 3 || label.includes("cancel")) {
    return "cancelled";
  }
  if (/devolvid|estorn|reembols|chargeback/.test(label)) {
    return "refunded";
  }
  if (/aguardando|pendente|pending|análise|analise/.test(label)) {
    return "pending";
  }
  return "paid";
}

export function normalizeManualCommerceOrder(
  payload: ManualCommerceOrderPayload,
): ShopifyOrder {
  const externalOrderId = firstString(
    payload.id,
    payload.order_id,
    payload.id_pedido,
    payload.pedido_id,
    payload.codigo,
    payload.numero,
    payload.pedido,
    payload.numero_pedido,
    payload.number,
    payload.whatsapp_id,
    payload.telefone,
    payload.phone,
  );
  if (!externalOrderId) {
    throw new Error("Manual commerce order is missing an id");
  }

  const placedAt =
    firstString(
      // Magazord order date (converted to ISO — see magazordIsoDate).
      magazordIsoDate(payload.dataHora),
      payload.created_at,
      payload.data,
      payload.data_pedido,
      payload.data_do_pedido,
      payload.criado_em,
      // Loja Integrada (Tastypie) stamps order creation as `data_criacao`.
      payload.data_criacao,
      payload.date,
      payload.placed_at,
    ) ?? "";
  // No parseable date → "" so the downstream parsePlacedAt guard SKIPS the
  // order instead of attributing it to now() (which inflated today's revenue).

  // WBuy nests line items under `produtos`.
  const rawItems =
    payload.itens ?? payload.items ?? payload.line_items ?? payload.produtos;
  const items = normalizeItems(rawItems);
  const itemsCount =
    firstFiniteInteger(
      payload.items_count,
      payload.total_items,
      payload.total_itens,
      payload.qtd_vendas,
      payload.quantidade_vendas,
      payload.quantidade,
      payload.qtd,
    ) ?? sumItemsCount(rawItems);

  return {
    externalOrderId,
    orderNumber: firstString(
      payload.numero,
      payload.pedido,
      payload.number,
      payload.order_number,
      // Magazord: `codigo` is the human-facing order number.
      payload.codigo,
    ),
    orderTotal:
      normalizeMoney(
        firstString(
          moneyFromMaybeObject(payload.valor_total),
          // Magazord v2: valorTotal = produto + frete − desconto + acréscimo.
          payload.valorTotal,
          payload.total,
          payload.total_price,
          payload.valor,
          payload.faturamento,
          payload.receita,
          payload.aprovado,
        ),
      ) ?? "0",
    orderCurrency:
      firstString(payload.moeda, payload.currency, payload.orderCurrency) ??
      "BRL",
    customerEmail: firstString(
      payload.email,
      payload.customer_email,
      payload.cliente_email,
    ),
    itemsCount,
    items,
    status:
      firstString(
        // Magazord situação (pedidoSituacaoTipo/Descricao) → canonical status.
        magazordStatusLabel(payload),
        // Loja Integrada situacao FK (code/URI) → PT term. Wins over the raw
        // `payload.situacao` (which may be a non-matching URI string).
        lojaIntegradaSituacaoLabel(payload.situacao),
        lojaIntegradaSituacaoLabel(payload.situacao_id),
        statusFromMaybeObject(payload.status),
        statusFromMaybeObject(payload.situacao),
        payload.payment_status,
        payload.status_pagamento,
        payload.aprovacao,
      ) ?? "APPROVED",
    shippingState: firstString(
      payload.uf,
      payload.estado,
      payload.estado_uf,
      payload.state,
      payload.shipping_state,
      // WBuy carries the customer's state in the order's `cliente.uf` — without
      // this every WBuy order synced with a null state, leaving "vendas por
      // estado" empty.
      (payload.cliente as Record<string, unknown> | undefined)?.uf,
      (payload.cliente as Record<string, unknown> | undefined)?.estado,
      (payload.entrega as Record<string, unknown> | undefined)?.uf,
      (payload.endereco_entrega as Record<string, unknown> | undefined)?.uf,
      (payload.shipping_address as Record<string, unknown> | undefined)
        ?.province_code,
      (payload.shipping_address as Record<string, unknown> | undefined)?.state,
    ),
    placedAt,
    utmSource: firstString(payload.utm_source, payload.origem, payload.source),
    utmMedium: firstString(payload.utm_medium, payload.midia, payload.medium),
    utmCampaign: firstString(
      payload.utm_campaign,
      payload.campanha,
      payload.campaign,
    ),
  };
}
