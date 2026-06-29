import { describe, expect, it } from "vitest";

import { isApprovedOrderStatus } from "@/lib/metrics/order-status";

/**
 * WBuy uses the order status as a FULFILLMENT state, and only advances an order
 * to fulfillment after payment is confirmed. So for WBuy a fulfillment state is
 * a paid sale — but only for WBuy; the generic rule still treats fulfillment as
 * not-yet-paid.
 */
describe("isApprovedOrderStatus — WBuy fulfillment", () => {
  it("counts WBuy fulfillment states as paid", () => {
    expect(isApprovedOrderStatus("Em expedição", "WBUY")).toBe(true);
    expect(isApprovedOrderStatus("Em produção", "WBUY")).toBe(true);
    expect(isApprovedOrderStatus("Em separação", "WBUY")).toBe(true);
    expect(isApprovedOrderStatus("Pedido concluído", "WBUY")).toBe(true);
    expect(isApprovedOrderStatus("Pagamento efetuado", "WBUY")).toBe(true);
  });

  it("still rejects unpaid/cancelled WBuy states", () => {
    expect(isApprovedOrderStatus("Pagamento negado", "WBUY")).toBe(false);
    expect(isApprovedOrderStatus("Aguardando pagamento", "WBUY")).toBe(false);
    expect(isApprovedOrderStatus("Pedido cancelado", "WBUY")).toBe(false);
  });

  it("does NOT relax the rule for other providers", () => {
    expect(isApprovedOrderStatus("Em expedição")).toBe(false);
    expect(isApprovedOrderStatus("Em expedição", "SHOPIFY")).toBe(false);
    expect(isApprovedOrderStatus("Em produção", "NUVEMSHOP")).toBe(false);
  });
});
