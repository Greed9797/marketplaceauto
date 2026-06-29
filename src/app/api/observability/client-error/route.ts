import { NextRequest } from "next/server";
import { z } from "zod";

import { logAudit } from "@/lib/audit/log";
import { auth } from "@/lib/auth/auth";
import {
  buildAnalyticsEvent,
  buildSanitizedClientError,
} from "@/lib/observability/analytics";

export const runtime = "nodejs";

const clientErrorSchema = z.object({
  message: z.string().min(1).max(500),
  stack: z.string().max(1800).optional(),
  path: z.string().max(200).optional(),
  digest: z.string().max(120).optional(),
});

export async function POST(request: NextRequest) {
  // Client error boundaries run in the authenticated user's browser — require a
  // session so anonymous internet actors can't flood the audit log with
  // attacker-controlled strings. Per-client rate limiting is enforced at the
  // middleware (see classifyRateLimitTarget: /api/observability).
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = clientErrorSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return Response.json(
      { ok: false, error: "invalid-payload" },
      { status: 400 },
    );
  }

  const error = buildSanitizedClientError(body.data);
  const metadata = {
    message: error.message,
    path: error.path,
    digest: error.digest,
    stack: error.stack,
    event: buildAnalyticsEvent({
      name: "client_error",
      userId: session.user.id,
      properties: {
        path: error.path,
      },
    }),
  };

  try {
    await logAudit({
      action: "observability.client_error",
      userId: session.user.id,
      resourceType: "clientError",
      metadata: JSON.parse(JSON.stringify(metadata)),
    });
  } catch {
    // Never fail an observability ingest path because of audit storage issues.
  }

  return Response.json({ ok: true });
}
