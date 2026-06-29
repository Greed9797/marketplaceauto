import Decimal from "decimal.js";

import { callWithRetry } from "@/lib/connectors/retry";

import type { GoogleAdsConfig } from "./oauth";

type FetchLike = typeof fetch;

type GoogleAdsTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

type AccessibleCustomersResponse = {
  resourceNames?: string[];
};

type GoogleAdsMetricRow = {
  campaign?: {
    id?: string | number;
    name?: string;
    status?: string;
    advertisingChannelType?: string;
    advertisingChannelSubType?: string;
  };
  metrics?: {
    costMicros?: string | number;
    impressions?: string | number;
    clicks?: string | number;
    conversions?: string | number;
    conversionsValue?: string | number;
  };
  segments?: {
    date?: string;
  };
};

type GoogleAdsSearchResponse = {
  results?: GoogleAdsMetricRow[];
  nextPageToken?: string;
};

type GoogleAdsCustomerClientRow = {
  customerClient?: {
    id?: string | number;
    clientCustomer?: string;
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
    manager?: boolean;
    level?: string | number;
  };
};

type GoogleAdsCustomerClientResponse = {
  results?: GoogleAdsCustomerClientRow[];
  nextPageToken?: string;
};

export type GoogleAdsCampaignMetric = {
  campaignId: string | null;
  campaignName: string | null;
  campaignStatus?: string | null;
  campaignObjective?: string | null;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  conversions: string | null;
  conversionsValue: string | null;
  date: string;
};

export type GoogleAdsSelectableCustomer = {
  id: string;
  name: string;
  resourceName: string;
  currencyCode?: string;
  timeZone?: string;
  isManager: boolean;
  level: number;
  loginCustomerId: string;
  rootCustomerId: string;
};

export const GOOGLE_ADS_CAMPAIGN_METRICS_QUERY = `
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign.advertising_channel_sub_type,
  metrics.cost_micros,
  metrics.impressions,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value,
  segments.date
FROM campaign
WHERE segments.date BETWEEN '{since}' AND '{until}'
`;

export const GOOGLE_ADS_CUSTOMER_CLIENT_QUERY = `
SELECT
  customer_client.client_customer,
  customer_client.level,
  customer_client.manager,
  customer_client.descriptive_name,
  customer_client.currency_code,
  customer_client.time_zone,
  customer_client.id
FROM customer_client
WHERE customer_client.level <= 1
`;

function summarizeGoogleAdsErrorBody(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        code?: number;
        status?: string;
        message?: string;
        details?: Array<{
          "@type"?: string;
          errors?: Array<{
            errorCode?: Record<string, string>;
            message?: string;
          }>;
        }>;
      };
    };
    const err = parsed.error;
    if (!err) return body.slice(0, 220);
    const errorCodes = (err.details ?? [])
      .flatMap((detail) => detail.errors ?? [])
      .map((entry) => {
        if (!entry.errorCode) return null;
        const [key, value] = Object.entries(entry.errorCode)[0] ?? [];
        return key && value ? `${key}=${value}` : null;
      })
      .filter((value): value is string => Boolean(value));
    const parts = [
      err.message,
      err.code != null ? `code=${err.code}` : null,
      err.status ? `status=${err.status}` : null,
      errorCodes.length ? errorCodes.join(",") : null,
    ].filter(Boolean) as string[];
    return parts.length > 0 ? parts.join(" | ") : body.slice(0, 220);
  } catch {
    return body.slice(0, 220);
  }
}

export class GoogleAdsApiError extends Error {
  status: number;
  body: string;
  response: {
    status: number;
    headers: Headers;
  };

  constructor(status: number, body: string, headers = new Headers()) {
    const summary = summarizeGoogleAdsErrorBody(body);
    super(
      summary
        ? `Google Ads API ${status}: ${summary}`
        : `Google Ads API request failed with status ${status}`,
    );
    this.name = "GoogleAdsApiError";
    this.status = status;
    this.body = body;
    this.response = { status, headers };
  }
}

async function fetchJson<T>(
  url: URL | string,
  fetchImpl: FetchLike,
  init?: RequestInit,
): Promise<T> {
  // Hard 20s per-request budget so hung Google Ads connections do not consume
  // the Vercel function until termination (~2 min default). Matches the Meta
  // client policy.
  const response = await fetchImpl(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new GoogleAdsApiError(response.status, body, response.headers);
  }

  return JSON.parse(body) as T;
}

function asString(value: string | number | undefined | null) {
  return value === undefined || value === null ? null : String(value);
}

export function costMicrosToCurrency(
  value: string | number | undefined | null,
) {
  if (value === undefined || value === null) {
    return null;
  }

  return new Decimal(value).div(1_000_000).toDecimalPlaces(2).toString();
}

function googleAdsCampaignObjective(campaign: GoogleAdsMetricRow["campaign"]) {
  const channelType = campaign?.advertisingChannelType;
  const channelSubType = campaign?.advertisingChannelSubType;

  if (!channelType) {
    return null;
  }

  if (
    channelSubType &&
    channelSubType !== "UNKNOWN" &&
    channelSubType !== "UNSPECIFIED"
  ) {
    return `${channelType} / ${channelSubType}`;
  }

  return channelType;
}

export function normalizeGoogleAdsMetricRow(
  row: GoogleAdsMetricRow,
): GoogleAdsCampaignMetric {
  return {
    campaignId: asString(row.campaign?.id),
    campaignName: row.campaign?.name ?? null,
    campaignStatus: row.campaign?.status ?? null,
    campaignObjective: googleAdsCampaignObjective(row.campaign),
    spend: costMicrosToCurrency(row.metrics?.costMicros),
    impressions: asString(row.metrics?.impressions),
    clicks: asString(row.metrics?.clicks),
    conversions: asString(row.metrics?.conversions),
    conversionsValue: asString(row.metrics?.conversionsValue),
    date: row.segments?.date ?? "",
  };
}

export function normalizeGoogleAdsCustomerClientRow(
  row: GoogleAdsCustomerClientRow,
  context: { rootCustomerId: string; loginCustomerId: string },
): GoogleAdsSelectableCustomer {
  const customerClient = row.customerClient ?? {};
  const id =
    asString(customerClient.id) ??
    customerClient.clientCustomer?.replace("customers/", "");
  if (!id) {
    throw new Error("Google Ads customer_client row is missing id");
  }

  return {
    id,
    name: customerClient.descriptiveName ?? `Google Ads ${id}`,
    resourceName: customerClient.clientCustomer ?? `customers/${id}`,
    currencyCode: customerClient.currencyCode,
    timeZone: customerClient.timeZone,
    isManager: Boolean(customerClient.manager),
    level: Number(customerClient.level ?? 0),
    loginCustomerId: context.loginCustomerId,
    rootCustomerId: context.rootCustomerId,
  };
}

export function selectGoogleAdsAdvertiserAccounts(
  accounts: GoogleAdsSelectableCustomer[],
) {
  const unique = new Map<string, GoogleAdsSelectableCustomer>();

  for (const account of accounts) {
    if (!account.isManager && !unique.has(account.id)) {
      unique.set(account.id, account);
    }
  }

  return Array.from(unique.values());
}

export class GoogleAdsClient {
  private readonly config: GoogleAdsConfig;
  private readonly fetchImpl: FetchLike;

  constructor(input: { config: GoogleAdsConfig; fetchImpl?: FetchLike }) {
    this.config = input.config;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  private googleAdsHeaders(
    accessToken: string,
    options: {
      includeLoginCustomerId?: boolean;
      loginCustomerId?: string;
    } = {},
  ) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": this.config.developerToken,
      "Content-Type": "application/json",
    };
    const loginCustomerId =
      options.loginCustomerId ?? this.config.loginCustomerId;

    if (options.includeLoginCustomerId !== false && loginCustomerId) {
      headers["login-customer-id"] = loginCustomerId;
    }

    return headers;
  }

  async exchangeCodeForTokens(code: string) {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.config.redirectUri,
    });

    return callWithRetry(() =>
      fetchJson<GoogleAdsTokenResponse>(
        "https://oauth2.googleapis.com/token",
        this.fetchImpl,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        },
      ),
    );
  }

  async refreshAccessToken(refreshToken: string) {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    return callWithRetry(() =>
      fetchJson<GoogleAdsTokenResponse>(
        "https://oauth2.googleapis.com/token",
        this.fetchImpl,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        },
      ),
    );
  }

  async listAccessibleCustomers(accessToken: string) {
    const url = `https://googleads.googleapis.com/${this.config.apiVersion}/customers:listAccessibleCustomers`;
    const response = await callWithRetry(() =>
      fetchJson<AccessibleCustomersResponse>(url, this.fetchImpl, {
        headers: this.googleAdsHeaders(accessToken, {
          includeLoginCustomerId: false,
        }),
      }),
    );

    return (response.resourceNames ?? []).map((resourceName) => ({
      resourceName,
      customerId: resourceName.replace("customers/", ""),
      displayName: `Google Ads ${resourceName.replace("customers/", "")}`,
    }));
  }

  async searchCustomerClients(input: {
    accessToken: string;
    rootCustomerId: string;
    loginCustomerId?: string;
  }) {
    const accounts: GoogleAdsSelectableCustomer[] = [];
    let pageToken: string | undefined;
    const url = `https://googleads.googleapis.com/${this.config.apiVersion}/customers/${input.rootCustomerId}/googleAds:search`;
    const loginCustomerId = input.loginCustomerId ?? input.rootCustomerId;

    do {
      const response = await callWithRetry(() =>
        fetchJson<GoogleAdsCustomerClientResponse>(url, this.fetchImpl, {
          method: "POST",
          headers: this.googleAdsHeaders(input.accessToken, {
            loginCustomerId,
          }),
          body: JSON.stringify({
            query: GOOGLE_ADS_CUSTOMER_CLIENT_QUERY,
            pageToken,
          }),
        }),
      );

      accounts.push(
        ...(response.results ?? []).map((row) =>
          normalizeGoogleAdsCustomerClientRow(row, {
            rootCustomerId: input.loginCustomerId ?? input.rootCustomerId,
            loginCustomerId,
          }),
        ),
      );
      pageToken = response.nextPageToken;
    } while (pageToken);

    return accounts;
  }

  async listSelectableCustomers(accessToken: string) {
    const accessibleCustomers = await this.listAccessibleCustomers(accessToken);
    const expanded: GoogleAdsSelectableCustomer[] = [];
    const visited = new Set<string>();

    for (const customer of accessibleCustomers) {
      const loginCustomerId = customer.customerId;
      const queue = [customer.customerId];
      let hierarchyFound = false;

      while (queue.length > 0) {
        const currentCustomerId = queue.shift();
        if (!currentCustomerId) {
          continue;
        }

        const visitKey = `${loginCustomerId}:${currentCustomerId}`;
        if (visited.has(visitKey)) {
          continue;
        }
        visited.add(visitKey);

        try {
          const hierarchy = await this.searchCustomerClients({
            accessToken,
            rootCustomerId: currentCustomerId,
            loginCustomerId,
          });
          hierarchyFound = true;
          expanded.push(...hierarchy);

          for (const account of hierarchy) {
            if (account.isManager && account.id !== currentCustomerId) {
              queue.push(account.id);
            }
          }
        } catch {
          if (!hierarchyFound && currentCustomerId === customer.customerId) {
            expanded.push({
              id: customer.customerId,
              name: customer.displayName,
              resourceName: customer.resourceName,
              isManager: false,
              level: 0,
              loginCustomerId,
              rootCustomerId: customer.customerId,
            });
          }
        }
      }
    }

    return selectGoogleAdsAdvertiserAccounts(expanded);
  }

  async searchCampaignMetrics(input: {
    accessToken: string;
    customerId: string;
    since: string;
    until: string;
    loginCustomerId?: string;
  }) {
    const metrics: GoogleAdsCampaignMetric[] = [];
    let pageToken: string | undefined;
    // Google Ads GAQL BETWEEN requires YYYY-MM-DD; full ISO timestamps trip
    // INVALID_VALUE_WITH_BETWEEN_OPERATOR. Callers may pass either form.
    const since = input.since.slice(0, 10);
    const until = input.until.slice(0, 10);
    const query = GOOGLE_ADS_CAMPAIGN_METRICS_QUERY.replace(
      "{since}",
      since,
    ).replace("{until}", until);
    const url = `https://googleads.googleapis.com/${this.config.apiVersion}/customers/${input.customerId}/googleAds:search`;

    do {
      const response = await callWithRetry(() =>
        fetchJson<GoogleAdsSearchResponse>(url, this.fetchImpl, {
          method: "POST",
          headers: this.googleAdsHeaders(input.accessToken, {
            loginCustomerId: input.loginCustomerId,
          }),
          body: JSON.stringify({
            query,
            pageToken,
          }),
        }),
      );

      metrics.push(
        ...(response.results ?? []).map(normalizeGoogleAdsMetricRow),
      );
      pageToken = response.nextPageToken;
    } while (pageToken);

    return metrics.filter((metric) => metric.date);
  }
}
