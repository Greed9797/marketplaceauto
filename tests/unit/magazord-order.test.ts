import { describe, expect, it } from "vitest";

import { normalizeManualCommerceOrder } from "@/lib/connectors/manual-commerce";
import { isApprovedOrderStatus } from "@/lib/metrics/order-status";

/**
 * Magazord v2 (`/api/v2/site/pedido`) real payload shape (Br Artes store):
 * dates come as "YYYY-MM-DD HH:mm:ss-03" in `dataHora`, money in camelCase
 * `valorTotal`, and status as `pedidoSituacao`/`pedidoSituacaoDescricao`/
 * `pedidoSituacaoTipo`. None of these matched the generic normalizer before,
 * so every Magazord order was skipped (invalid placedAt) with orderTotal "0".
 */
function magazordPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 2476,
    codigo: "0012606136932",
    codigoMarketplace: null,
    dataHora: "2026-06-01 09:36:12-03",
    dataHoraUltimaAlteracao: "2026-07-01 21:04:02-03",
    valorProduto: "1089.900000",
    valorFrete: "0.00",
    valorDesconto: "217.98",
    valorAcrescimo: "0.00",
    valorTotal: "871.92",
    formaPagamentoNome: "Cartão - Visa",
    pedidoSituacao: 7,
    pedidoSituacaoDescricao: "Transporte",
    pedidoSituacaoTipo: 1,
    lojaId: 1,
    ...overrides,
  };
}

describe("normalizeManualCommerceOrder — Magazord v2", () => {
  it("parses dataHora (space + short offset) into a valid ISO placedAt", () => {
    const order = normalizeManualCommerceOrder(magazordPayload());

    expect(order.placedAt).toBe("2026-06-01T12:36:12.000Z");
  });

  it("reads the order total from camelCase valorTotal", () => {
    const order = normalizeManualCommerceOrder(magazordPayload());

    expect(order.orderTotal).toBe("871.92");
    expect(order.externalOrderId).toBe("2476");
    expect(order.orderNumber).toBe("0012606136932");
  });

  it("maps post-payment situações to paid (counted as revenue)", () => {
    for (const descricao of [
      "Transporte",
      "Entregue",
      "Crédito e Cadastro Aprovados",
    ]) {
      const order = normalizeManualCommerceOrder(
        magazordPayload({ pedidoSituacaoDescricao: descricao }),
      );

      expect(order.status).toBe("paid");
      expect(isApprovedOrderStatus(order.status, "MAGAZORD")).toBe(true);
    }
  });

  it("maps cancelado (tipo 3) to cancelled and out of revenue", () => {
    const order = normalizeManualCommerceOrder(
      magazordPayload({
        pedidoSituacao: 2,
        pedidoSituacaoDescricao: "Cancelado",
        pedidoSituacaoTipo: 3,
      }),
    );

    expect(order.status).toBe("cancelled");
    expect(isApprovedOrderStatus(order.status, "MAGAZORD")).toBe(false);
  });

  it("maps devolvido to refunded and aguardando pagamento to pending", () => {
    const refunded = normalizeManualCommerceOrder(
      magazordPayload({
        pedidoSituacao: 17,
        pedidoSituacaoDescricao: "Devolvido",
        pedidoSituacaoTipo: 2,
      }),
    );
    const pending = normalizeManualCommerceOrder(
      magazordPayload({
        pedidoSituacao: 1,
        pedidoSituacaoDescricao: "Aguardando Pagamento",
        pedidoSituacaoTipo: 1,
      }),
    );

    expect(refunded.status).toBe("refunded");
    expect(isApprovedOrderStatus(refunded.status, "MAGAZORD")).toBe(false);
    expect(pending.status).toBe("pending");
    expect(isApprovedOrderStatus(pending.status, "MAGAZORD")).toBe(false);
  });

  it("does not affect non-Magazord payloads (no situação fields)", () => {
    const order = normalizeManualCommerceOrder({
      id: "99",
      data: "2026-06-10",
      total: "100.00",
      status: "aprovado",
    });

    expect(order.status).toBe("aprovado");
    expect(order.placedAt).toBe("2026-06-10");
  });
});
