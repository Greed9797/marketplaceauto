import { describe, expect, it } from "vitest";

import { normalizeManualCommerceOrder } from "@/lib/connectors/manual-commerce";
import { isApprovedOrderStatus } from "@/lib/metrics/order-status";

/**
 * Loja Integrada situacao codes must map to the correct PAYMENT term so revenue
 * only counts paid orders. Regression guard for the cross-platform "efetuado"
 * collision: LI code 9 ("Pedido efetuado") is placed-but-NOT-paid, while WBuy
 * "Pagamento efetuado" is paid. They must not share an approved term.
 */
describe("Loja Integrada status → revenue mapping", () => {
  function statusFor(situacao: number): string {
    return normalizeManualCommerceOrder({
      id: `li-${situacao}`,
      total: "100.00",
      situacao,
    }).status as string;
  }

  it("does NOT count code 9 (placed, not paid) as revenue", () => {
    expect(isApprovedOrderStatus(statusFor(9))).toBe(false);
  });

  it("counts paid and post-payment fulfillment codes as revenue", () => {
    expect(isApprovedOrderStatus(statusFor(4))).toBe(true); // pago
    expect(isApprovedOrderStatus(statusFor(11))).toBe(true); // enviado (post-paid)
    expect(isApprovedOrderStatus(statusFor(13))).toBe(true); // em separação (post-paid)
    expect(isApprovedOrderStatus(statusFor(14))).toBe(true); // entregue
  });

  it("does NOT count pending/cancelled/refunded codes as revenue", () => {
    expect(isApprovedOrderStatus(statusFor(2))).toBe(false); // aguardando
    expect(isApprovedOrderStatus(statusFor(3))).toBe(false); // pendente
    expect(isApprovedOrderStatus(statusFor(7))).toBe(false); // estornado
    expect(isApprovedOrderStatus(statusFor(8))).toBe(false); // cancelado
  });
});
