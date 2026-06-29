import type { GoogleAnalyticsConfig } from "./oauth";

type FetchImpl = typeof fetch;

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

type AccountSummariesResponse = {
  accountSummaries?: Array<{
    account?: string;
    displayName?: string;
    propertySummaries?: Array<{
      property?: string;
      displayName?: string;
      propertyType?: string;
    }>;
  }>;
};

type RunReportResponse = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
};

export type GoogleAnalyticsProperty = {
  propertyId: string;
  propertyResourceName: string;
  accountResourceName: string | null;
  accountName: string;
  propertyName: string;
};

export type GoogleAnalyticsSessionMetric = {
  date: string;
  sourceMedium: string;
  sessions: string;
};

async function fetchJson<T>(
  url: string,
  fetchImpl: FetchImpl,
  init: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, init);
  const body = await response.text();
  const json = body ? JSON.parse(body) : null;

  if (!response.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? JSON.stringify(json.error)
        : body || response.statusText;
    throw new Error(message);
  }

  return json as T;
}

function bearerHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

function propertyIdFromResourceName(resourceName: string | undefined) {
  return resourceName?.replace("properties/", "") ?? "";
}

export class GoogleAnalyticsClient {
  private readonly config: GoogleAnalyticsConfig;
  private readonly fetchImpl: FetchImpl;

  constructor(input: { config: GoogleAnalyticsConfig; fetchImpl?: FetchImpl }) {
    this.config = input.config;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async exchangeCodeForTokens(code: string) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.config.redirectUri,
    });

    return fetchJson<GoogleTokenResponse>(
      "https://oauth2.googleapis.com/token",
      this.fetchImpl,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );
  }

  async refreshAccessToken(refreshToken: string) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    return fetchJson<GoogleTokenResponse>(
      "https://oauth2.googleapis.com/token",
      this.fetchImpl,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );
  }

  async listProperties(
    accessToken: string,
  ): Promise<GoogleAnalyticsProperty[]> {
    const response = await fetchJson<AccountSummariesResponse>(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      this.fetchImpl,
      {
        headers: bearerHeaders(accessToken),
      },
    );

    return (response.accountSummaries ?? []).flatMap((account) =>
      (account.propertySummaries ?? []).flatMap((property) => {
        const propertyId = propertyIdFromResourceName(property.property);
        if (
          !propertyId ||
          property.propertyType === "PROPERTY_TYPE_UNIVERSAL_ANALYTICS"
        ) {
          return [];
        }

        return [
          {
            propertyId,
            propertyResourceName:
              property.property ?? `properties/${propertyId}`,
            accountResourceName: account.account ?? null,
            accountName: account.displayName ?? "Conta Google Analytics",
            propertyName: property.displayName ?? `Propriedade ${propertyId}`,
          },
        ];
      }),
    );
  }

  async runSessionsReport(input: {
    accessToken: string;
    propertyId: string;
    since: string;
    until: string;
  }): Promise<GoogleAnalyticsSessionMetric[]> {
    const response = await fetchJson<RunReportResponse>(
      `https://analyticsdata.googleapis.com/v1beta/properties/${input.propertyId}:runReport`,
      this.fetchImpl,
      {
        method: "POST",
        headers: bearerHeaders(input.accessToken),
        body: JSON.stringify({
          // GA4 Data API requires YYYY-MM-DD; full ISO timestamps trigger
          // INVALID_ARGUMENT "startDate must be YYYY-MM-DD, NdaysAgo,
          // yesterday, or today."
          dateRanges: [
            {
              startDate: input.since.slice(0, 10),
              endDate: input.until.slice(0, 10),
            },
          ],
          dimensions: [{ name: "date" }, { name: "sessionSourceMedium" }],
          metrics: [{ name: "sessions" }],
          limit: 100000,
        }),
      },
    );

    return (response.rows ?? []).map((row) => ({
      date: row.dimensionValues?.[0]?.value ?? "",
      sourceMedium: row.dimensionValues?.[1]?.value ?? "Sem origem/midia",
      sessions: row.metricValues?.[0]?.value ?? "0",
    }));
  }
}
