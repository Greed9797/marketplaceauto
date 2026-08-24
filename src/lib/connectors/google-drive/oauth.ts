import type { ConnectorProvider } from "@prisma/client";

import { resolveAppOrigin } from "@/lib/auth/origin";

export const GOOGLE_DRIVE_OAUTH_STATE_COOKIE = "adstart_gdrive_oauth_state";

export const GOOGLE_DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

export type GoogleDriveOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/**
 * Reuses the same Google OAuth client as login (GOOGLE_OAUTH_CLIENT_ID/SECRET).
 * The redirect URI must be registered in the Google Cloud console OAuth client
 * as `{origin}/api/connectors/google-drive/callback`.
 */
export function getGlobalGoogleDriveConfig(
  origin: string,
): GoogleDriveOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    redirectUri: `${origin}/api/connectors/google-drive/callback`,
  };
}

export async function getGoogleDriveConfigForRequest(): Promise<
  GoogleDriveOAuthConfig | null
> {
  const origin = await resolveAppOrigin();
  return getGlobalGoogleDriveConfig(origin);
}

export function buildGoogleDriveAuthUrl(input: {
  config: GoogleDriveOAuthConfig;
  provider: Extract<ConnectorProvider, "GOOGLE_DRIVE">;
  state: string;
}) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("response_type", "code");
  // drive.file = per-file access to files the app created. Least privilege:
  // the app cannot see or touch anything else in the user's Drive.
  url.searchParams.set("scope", GOOGLE_DRIVE_SCOPE);
  // offline + consent guarantee a refresh token on every (re)connect.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", input.state);

  return url.toString();
}

export type GoogleDriveTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string | null;
};

export async function exchangeGoogleDriveCode(input: {
  config: GoogleDriveOAuthConfig;
  code: string;
}): Promise<GoogleDriveTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: input.config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`google_drive_token_exchange_failed: ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!payload.access_token) {
    throw new Error("google_drive_token_exchange_missing_access_token");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresIn: payload.expires_in ?? 3600,
    scope: payload.scope ?? null,
  };
}

export async function refreshGoogleDriveAccessToken(input: {
  config: GoogleDriveOAuthConfig;
  refreshToken: string;
}): Promise<GoogleDriveTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: input.refreshToken,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`google_drive_token_refresh_failed: ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!payload.access_token) {
    throw new Error("google_drive_token_refresh_missing_access_token");
  }

  return {
    accessToken: payload.access_token,
    // Google does not rotate the refresh token on a refresh grant.
    refreshToken: null,
    expiresIn: payload.expires_in ?? 3600,
    scope: payload.scope ?? null,
  };
}
