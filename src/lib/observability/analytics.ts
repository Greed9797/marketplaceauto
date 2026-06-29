type EnvLike = Record<string, string | undefined>;

export type AnalyticsEventName =
  | "signup"
  | "connector_connect"
  | "dashboard_view"
  | "data_export_request"
  | "delete_account_request"
  | "feedback_submit"
  | "client_error";

type AnalyticsEventInput = {
  name:
    | AnalyticsEventName;
  userId: string;
  workspaceId?: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
};

export type AnalyticsEvent = ReturnType<typeof buildAnalyticsEvent>;

type ClientErrorInput = {
  message: string;
  stack?: string;
  path?: string;
  digest?: string;
};

const blockedPropertyKeys = new Set(["email", "name", "customerEmail", "accessToken", "refreshToken"]);
const sensitiveValuePattern =
  /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|access[_-]?token=[^&\s]+|refresh[_-]?token=[^&\s]+|token\s+[^\s]+)/gi;

function redactSensitiveValues(value: string) {
  return value.replace(sensitiveValuePattern, "[redacted]");
}

function redactErrorMessage(value: string) {
  const redacted = redactSensitiveValues(value);
  return redacted === value ? value : "[redacted]";
}

function redactErrorStack(value: string) {
  return value
    .split("\n")
    .map((line) => {
      const redacted = redactSensitiveValues(line);
      if (redacted === line) {
        return line;
      }

      const prefixMatch = line.match(/^(\s*[A-Za-z]+):/);
      return prefixMatch ? `${prefixMatch[1]}: [redacted]` : "[redacted]";
    })
    .join("\n");
}

export function isPostHogEnabled(env: EnvLike = process.env) {
  return Boolean(env.NEXT_PUBLIC_POSTHOG_KEY);
}

export function getPostHogConfig(env: EnvLike = process.env) {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) {
    return null;
  }

  const host = (env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com").replace(/\/+$/, "");

  return {
    apiKey: env.NEXT_PUBLIC_POSTHOG_KEY,
    host,
  };
}

export function buildAnalyticsEvent(input: AnalyticsEventInput) {
  const properties: Record<string, string | number | boolean> = {};

  if (input.workspaceId) {
    properties.workspaceId = input.workspaceId;
  }

  for (const [key, value] of Object.entries(input.properties ?? {})) {
    if (value !== undefined && value !== null && !blockedPropertyKeys.has(key)) {
      properties[key] = value;
    }
  }

  return {
    name: input.name,
    distinctId: input.userId,
    properties,
    };
}

export function buildPostHogCapturePayload(apiKey: string, event: AnalyticsEvent) {
  return {
    api_key: apiKey,
    event: event.name,
    distinct_id: event.distinctId,
    properties: event.properties,
  };
}

export function buildSanitizedClientError(input: ClientErrorInput) {
  const path = input.path?.split("?")[0];

  return {
    message: redactErrorMessage(input.message),
    stack: input.stack ? redactErrorStack(input.stack).slice(0, 1800) : undefined,
    path: path && path.startsWith("/") && !path.startsWith("//") ? path : undefined,
    digest: input.digest?.slice(0, 120),
  };
}
