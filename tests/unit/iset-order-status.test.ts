import { describe, expect, it } from "vitest";

import {
  normalizeIsetOrder,
  type IsetOrder,
} from "@/lib/connectors/iset/client";
import { isApprovedOrderStatus } from "@/lib/metrics/order-status";

function isApproved(order: IsetOrder): boolean {
  return isApprovedOrderStatus(normalizeIsetOrder(order).status);
}

describe("normalizeIsetOrder — approved-sales gate", () => {
  it("counts an order paid by datePaid as approved", () => {
    const order: IsetOrder = {
      orderId: 1,
      orderTotal: 200,
      orderTotalPaid: 200,
      datePaid: "2026-06-01 10:00:00",
      datePurchased: "2026-06-01 09:00:00",
    };

    expect(normalizeIsetOrder(order).status).toBe("paid");
    expect(isApproved(order)).toBe(true);
  });

  it("counts an order with orderTotalPaid > 0 but no datePaid as approved", () => {
    const order: IsetOrder = {
      orderId: 2,
      orderTotal: 150,
      orderTotalPaid: 150,
      datePaid: null,
      datePurchased: "2026-06-02 09:00:00",
    };

    expect(isApproved(order)).toBe(true);
  });

  it("EXCLUDES a pending order with no payment (the inflated-revenue bug)", () => {
    const order: IsetOrder = {
      orderId: 3,
      orderTotal: 999,
      orderTotalPaid: 0,
      datePaid: null,
      orderIsComplete: false,
      datePurchased: "2026-06-03 09:00:00",
    };

    expect(normalizeIsetOrder(order).status).toBe("pending");
    expect(isApproved(order)).toBe(false);
  });

  it("EXCLUDES an unpaid order even when orderIsComplete is true", () => {
    // Regression: `orderIsComplete` used to mark such orders as "completed"
    // (approved), leaking unpaid orders into the revenue total.
    const order: IsetOrder = {
      orderId: 4,
      orderTotal: 500,
      orderTotalPaid: 0,
      datePaid: null,
      orderIsComplete: true,
      datePurchased: "2026-06-04 09:00:00",
    };

    expect(normalizeIsetOrder(order).status).toBe("pending");
    expect(isApproved(order)).toBe(false);
  });

  it("EXCLUDES a brand-new order with no payment fields written yet", () => {
    // Most common real shape of a just-placed iSET order before any payment
    // info exists: orderTotalPaid undefined, datePaid null.
    const order: IsetOrder = {
      orderId: 7,
      orderTotal: 100,
      datePaid: null,
      datePurchased: "2026-06-07 09:00:00",
    };

    expect(normalizeIsetOrder(order).status).toBe("pending");
    expect(isApproved(order)).toBe(false);
  });

  it("treats a blank datePaid string as unpaid", () => {
    const order: IsetOrder = {
      orderId: 5,
      orderTotal: 80,
      orderTotalPaid: 0,
      datePaid: "   ",
      datePurchased: "2026-06-05 09:00:00",
    };

    expect(isApproved(order)).toBe(false);
  });

  it("preserves the order total as the sale value for paid orders", () => {
    const order: IsetOrder = {
      orderId: 6,
      orderTotal: 349.9,
      orderTotalPaid: 349.9,
      datePaid: "2026-06-06 10:00:00",
      datePurchased: "2026-06-06 09:00:00",
    };

    expect(normalizeIsetOrder(order).orderTotal).toBe("349.9");
  });
});
