import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { getOperationalHealth } from "@/lib/health/checks";

export const runtime = "nodejs";

// Per-process random key: comparing HMAC digests (fixed 32-byte length) instead
// of raw token bytes keeps the comparison constant-time even when the supplied
// token differs in length from the configured one (no length-leak via timing).
const HMAC_KEY = randomBytes(32);

function constantTimeEquals(a: string, b: string): boolean {
  const digestA = createHmac("sha256", HMAC_KEY).update(a).digest();
  const digestB = createHmac("sha256", HMAC_KEY).update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Returns true only when HEALTH_CHECK_TOKEN is configured AND the request
 * carries a matching `Authorization: Bearer <token>`. With no token configured
 * the endpoint stays public in boolean-only mode (safe default).
 */
function isAuthorized(request: NextRequest): boolean {
  const token = process.env.HEALTH_CHECK_TOKEN?.trim();
  if (!token) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return constantTimeEquals(match[1].trim(), token);
}

export async function GET(request: NextRequest) {
  const health = await getOperationalHealth({ prisma });
  const status = health.ok ? 200 : 503;

  // Detailed operational breakdown (vault/redis/inngest topology) is a useful
  // fingerprint for an attacker, so it is gated behind HEALTH_CHECK_TOKEN. The
  // public response carries only liveness — enough for an uptime monitor.
  if (isAuthorized(request)) {
    return NextResponse.json(health, { status });
  }

  return NextResponse.json(
    { ok: health.ok, service: health.service, timestamp: health.timestamp },
    { status },
  );
}
