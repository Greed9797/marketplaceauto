import { ConnectorProvider } from "@prisma/client";

import type { ProviderConfigLike } from "./provider-config";

/**
 * Official "W3 Ads app" connector defaults sourced from env vars.
 *
 * For Google Ads, Google Analytics (GA4) and Meta we ship a single shared
 * OAuth app / access token so users only need to inform the account id + name.
 * Per-workspace ConnectorProviderConfig still takes precedence — these are the
 * fallback used both to pre-fill the settings form and to resolve credentials
 * at OAuth/sync time when no DB row exists or a field is left blank.
 *
 * Secret values never leave the server: the settings page only receives
 * `configuredSecretKeys` (via {@link publicProviderDefaults}), never the values.
 */

export type ProviderDefaults = {
  publicCredentials: Record<string, string>;
  /** Server-only. Never serialize this to the client. */
  secretValues: Record<string, string>;
  redirectUri: string | null;
  scopes: string | null;
  apiVersion: string | null;
};

/** Client-safe projection — exposes which secrets exist, not their values. */
export type PublicProviderDefaults = {
  publicCredentials: Record<string, string>;
  configuredSecretKeys: string[];
  redirectUri: string | null;
  scopes: string | null;
  apiVersion: string | null;
};

const GOOGLE_ADS_DEFAULT_SCOPES = "https://www.googleapis.com/auth/adwords";
const GOOGLE_ADS_DEFAULT_API_VERSION = "v24";
const GOOGLE_ANALYTICS_DEFAULT_SCOPES =
  "https://www.googleapis.com/auth/analytics.readonly";

function envValue(key: string): string | null {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

/**
 * Resolves the official env-backed defaults for a provider, including secret
 * values. Server-only — do not pass the result to client components.
 */
export function getProviderDefaults(
  provider: ConnectorProvider,
): ProviderDefaults | null {
  if (provider === ConnectorProvider.GOOGLE_ADS) {
    const clientId = envValue("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = envValue("GOOGLE_OAUTH_CLIENT_SECRET");
    const developerToken = envValue("GOOGLE_ADS_DEVELOPER_TOKEN");
    if (!clientId && !clientSecret && !developerToken) {
      return null;
    }

    const publicCredentials: Record<string, string> = {};
    if (clientId) publicCredentials.clientId = clientId;
    const loginCustomerId = envValue("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
    if (loginCustomerId) publicCredentials.loginCustomerId = loginCustomerId;

    const secretValues: Record<string, string> = {};
    if (clientSecret) secretValues.clientSecret = clientSecret;
    if (developerToken) secretValues.developerToken = developerToken;

    return {
      publicCredentials,
      secretValues,
      redirectUri: envValue("GOOGLE_ADS_REDIRECT_URI"),
      scopes: envValue("GOOGLE_ADS_SCOPES") ?? GOOGLE_ADS_DEFAULT_SCOPES,
      apiVersion:
        envValue("GOOGLE_ADS_API_VERSION") ?? GOOGLE_ADS_DEFAULT_API_VERSION,
    };
  }

  if (provider === ConnectorProvider.GA4) {
    const clientId = envValue("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = envValue("GOOGLE_OAUTH_CLIENT_SECRET");
    if (!clientId && !clientSecret) {
      return null;
    }

    const publicCredentials: Record<string, string> = {};
    if (clientId) publicCredentials.clientId = clientId;

    const secretValues: Record<string, string> = {};
    if (clientSecret) secretValues.clientSecret = clientSecret;

    return {
      publicCredentials,
      secretValues,
      redirectUri: envValue("GOOGLE_ANALYTICS_REDIRECT_URI"),
      scopes:
        envValue("GOOGLE_ANALYTICS_SCOPES") ?? GOOGLE_ANALYTICS_DEFAULT_SCOPES,
      apiVersion: null,
    };
  }

  if (provider === ConnectorProvider.META_ADS) {
    const accessToken = envValue("META_ACCESS_TOKEN");
    if (!accessToken) {
      return null;
    }

    return {
      publicCredentials: {},
      secretValues: { accessToken },
      redirectUri: envValue("META_REDIRECT_URI"),
      scopes: null,
      apiVersion: envValue("META_API_VERSION"),
    };
  }

  return null;
}

/** Returns the client-safe defaults projection (no secret values). */
export function publicProviderDefaults(
  provider: ConnectorProvider,
): PublicProviderDefaults | null {
  const defaults = getProviderDefaults(provider);
  if (!defaults) {
    return null;
  }

  return {
    publicCredentials: { ...defaults.publicCredentials },
    configuredSecretKeys: Object.keys(defaults.secretValues).sort(),
    redirectUri: defaults.redirectUri,
    scopes: defaults.scopes,
    apiVersion: defaults.apiVersion,
  };
}

export function hasProviderDefaults(provider: ConnectorProvider): boolean {
  return getProviderDefaults(provider) !== null;
}

/**
 * Builds an in-memory ProviderConfigLike from env defaults so OAuth connect /
 * sync can run even when the workspace never saved a ConnectorProviderConfig.
 * Secret resolution relies on the build* functions falling back to
 * `getProviderDefaults().secretValues` (this config carries no secretRefs).
 */
export function syntheticProviderConfigFromDefaults(
  workspaceId: string,
  provider: ConnectorProvider,
): ProviderConfigLike | null {
  const defaults = getProviderDefaults(provider);
  if (!defaults) {
    return null;
  }

  return {
    workspaceId,
    provider,
    status: "ACTIVE",
    redirectUri: defaults.redirectUri,
    scopes: defaults.scopes,
    apiVersion: defaults.apiVersion,
    publicCredentials: { ...defaults.publicCredentials },
    secretRefs: null,
  };
}
