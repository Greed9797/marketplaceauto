import { NextResponse, type NextRequest } from "next/server";

import { verifyNuvemshopWebhookHmac } from "@/lib/connectors/nuvemshop/webhook-hmac";

export const runtime = "nodejs";

/**
 * LGPD: customer data export request. Nuvemshop posts payload identifying the
 * customer; we just ack receipt. Our app stores no PII beyond customerEmail
 * on orders (already redactable via customers-redact), so we return 200 OK
 * to acknowledge compliance. Operational follow-up is handled out-of-band.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-linkedstore-hmac-sha256");

  const verification = await verifyNuvemshopWebhookHmac({ rawBody, signature });
  if (!verification.valid) {
     
    console.error(
      `[nuvemshop/customers-data-request] hmac invalid: ${verification.reason}`,
    );
    return NextResponse.json(
      { ok: false, error: "invalid-signature" },
      { status: 401 },
    );
  }

   
  console.info(
    `[nuvemshop/customers-data-request] received, body length=${rawBody.length}`,
  );

  return NextResponse.json({ ok: true });
}
