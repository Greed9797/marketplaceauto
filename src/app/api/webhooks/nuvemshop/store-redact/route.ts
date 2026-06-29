import { NextResponse, type NextRequest } from "next/server";
import { ConnectorProvider, ConnectorStatus } from "@prisma/client";

import { verifyNuvemshopWebhookHmac } from "@/lib/connectors/nuvemshop/webhook-hmac";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * LGPD: app uninstall, 48h after the store removes the app Nuvemshop calls
 * this endpoint with `{ store_id }`. We mark the connector account inactive
 * so syncs stop; data is cascaded-delete on real account removal which the
 * customer can trigger from /connectors directly.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-linkedstore-hmac-sha256");

  const verification = await verifyNuvemshopWebhookHmac({ rawBody, signature });
  if (!verification.valid) {
     
    console.error(
      `[nuvemshop/store-redact] hmac invalid: ${verification.reason}`,
    );
    return NextResponse.json(
      { ok: false, error: "invalid-signature" },
      { status: 401 },
    );
  }

  let payload: { store_id?: number | string } = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid-json" },
      { status: 400 },
    );
  }

  const storeId = payload.store_id != null ? String(payload.store_id) : "";
  if (!storeId) {
    return NextResponse.json({ ok: true, skipped: "no-store-id" });
  }

  await prisma.connectorAccount.updateMany({
    where: {
      provider: ConnectorProvider.NUVEMSHOP,
      externalAccountId: storeId,
    },
    data: {
      status: ConnectorStatus.REVOKED,
      lastSyncError: "Loja removeu o app (LGPD store/redact)",
    },
  });

  return NextResponse.json({ ok: true });
}
