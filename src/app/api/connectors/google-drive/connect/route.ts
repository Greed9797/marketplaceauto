import { ConnectorProvider } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/current";
import { canOperateWorkspaceConnectors } from "@/lib/auth/platform-permissions";
import {
  buildGoogleDriveAuthUrl,
  getGoogleDriveConfigForRequest,
  GOOGLE_DRIVE_OAUTH_STATE_COOKIE,
} from "@/lib/connectors/google-drive/oauth";
import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { createConnectorOAuthState } from "@/lib/connectors/oauth-state";

export const runtime = "nodejs";

function redirectToConnectors(request: NextRequest, error: string) {
  const url = new URL("/connectors", request.nextUrl.origin);
  url.searchParams.set("provider", "google_drive");
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  try {
    return await handleConnect(request);
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[google-drive/connect] start failed: ${message}`);
    return redirectToConnectors(request, "oauth-failed");
  }
}

async function handleConnect(request: NextRequest) {
  const context = await getCurrentUserContext();

  if (
    !canOperateWorkspaceConnectors(context.user, context.currentMembership.role)
  ) {
    return redirectToConnectors(request, "forbidden");
  }

  const config = await getGoogleDriveConfigForRequest();
  if (!config) {
    return redirectToConnectors(request, "missing-provider-config");
  }

  const state = createConnectorOAuthState({
    provider: "GOOGLE_DRIVE",
    userId: context.user.id,
    workspaceId: context.currentWorkspace.id,
  });

  const response = NextResponse.redirect(
    buildGoogleDriveAuthUrl({ config, provider: ConnectorProvider.GOOGLE_DRIVE, state }),
  );
  response.cookies.set(GOOGLE_DRIVE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}
