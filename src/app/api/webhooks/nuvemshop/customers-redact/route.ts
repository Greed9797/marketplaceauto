import { NextResponse, type NextRequest } from "next/server";
import { ConnectorProvider } from "@prisma/client";

import { verifyNuvemshopWebhookHmac } from "@/lib/connectors/nuvemshop/webhook-hmac";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * LGPD: customer right-to-be-forgotten. Nuvemshop posts `{ store_id, customer:
 * { email, ... }, orders_to_redact: [..] }`. We null out customerEmail on the
 * affected orders so PII is removed but order analytics survive.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-linkedstore-hmac-sha256");

  const verification = await verifyNuvemshopWebhookHmac({ rawBody, signature });
  if (!verification.valid) {
     
    console.error(
      `[nuvemshop/customers-redact] hmac invalid: ${verification.reason}`,
    );
    return NextResponse.json(
      { ok: false, error: "invalid-signature" },
      { status: 401 },
    );
  }

  let payload: {
    store_id?: number | string;
    customer?: { email?: string };
    orders_to_redact?: Array<number | string>;
  } = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid-json" },
      { status: 400 },
    );
  }

  const storeId = payload.store_id != null ? String(payload.store_id) : "";
  const ordersToRedact = (payload.orders_to_redact ?? []).map((value) =>
    String(value),
  );

  if (!storeId || ordersToRedact.length === 0) {
    return NextResponse.json({ ok: true, skipped: "nothing-to-redact" });
  }

  const accounts = await prisma.connectorAccount.findMany({
    where: {
      provider: ConnectorProvider.NUVEMSHOP,
      externalAccountId: storeId,
    },
    select: { id: true },
  });

  if (accounts.length === 0) {
    return NextResponse.json({ ok: true, skipped: "store-not-installed" });
  }

  await prisma.ecommerceOrder.updateMany({
    where: {
      connectorAccountId: { in: accounts.map((a) => a.id) },
      externalOrderId: { in: ordersToRedact },
    },
    data: {
      customerEmail: null,
    },
  });

  return NextResponse.json({ ok: true, redacted: ordersToRedact.length });
}
