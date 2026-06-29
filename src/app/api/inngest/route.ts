import { NextResponse, type NextRequest } from "next/server";
import { serve } from "inngest/next";

import { inngest } from "@/lib/jobs/inngest-client";
import { inngestFunctions } from "@/lib/jobs/functions";

const handlers = serve({
  client: inngest,
  functions: inngestFunctions,
});

/**
 * Defense-in-depth: in production refuse to dispatch when no signing key is
 * configured. `serve()` itself verifies signatures when the key is present,
 * but a missing/blank env would silently disable verification and let any
 * caller invoke registered functions (connector backfills, etc). We check at
 * request time so `next build` does not crash when running with a stripped
 * env.
 */
function withSigningKeyGuard<
  H extends (
    req: NextRequest,
    ...rest: unknown[]
  ) => Promise<Response> | Response,
>(handler: H): H {
  return (async (req: NextRequest, ...rest: unknown[]) => {
    if (
      process.env.VERCEL_ENV === "production" &&
      !process.env.INNGEST_SIGNING_KEY
    ) {
       
      console.error(
        "[inngest] refusing request: INNGEST_SIGNING_KEY not configured in production",
      );
      return NextResponse.json(
        { error: "inngest_signing_key_missing" },
        { status: 503 },
      );
    }
    return handler(req, ...rest);
  }) as H;
}

export const GET = withSigningKeyGuard(handlers.GET);
export const POST = withSigningKeyGuard(handlers.POST);
export const PUT = withSigningKeyGuard(handlers.PUT);
