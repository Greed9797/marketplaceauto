import { describe, expect, it } from "vitest";

import {
  buildAnalyticsEvent,
  buildPostHogCapturePayload,
  buildSanitizedClientError,
  getPostHogConfig,
  isPostHogEnabled,
} from "@/lib/observability/analytics";

describe("analytics helpers", () => {
  it("keeps PostHog disabled when no public key exists", () => {
    expect(isPostHogEnabled({})).toBe(false);
    expect(isPostHogEnabled({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" })).toBe(true);
  });

  it("normalizes PostHog config with a safe default host", () => {
    expect(getPostHogConfig({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" })).toEqual({
      apiKey: "phc_test",
      host: "https://app.posthog.com",
    });
    expect(
      getPostHogConfig({
        NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
        NEXT_PUBLIC_POSTHOG_HOST: "https://eu.posthog.com/",
      }),
    ).toEqual({
      apiKey: "phc_test",
      host: "https://eu.posthog.com",
    });
  });

  it("builds a safe analytics event without PII", () => {
    expect(
      buildAnalyticsEvent({
        name: "feedback_submit",
        userId: "user-1",
        workspaceId: "workspace-1",
        properties: {
          email: "cliente@w3.com",
          feedbackType: "BUG",
        },
      }),
    ).toEqual({
      name: "feedback_submit",
      distinctId: "user-1",
      properties: {
        workspaceId: "workspace-1",
        feedbackType: "BUG",
      },
    });
  });

  it("builds a PostHog capture payload without PII", () => {
    const event = buildAnalyticsEvent({
      name: "dashboard_view",
      userId: "user-1",
      workspaceId: "workspace-1",
      properties: {
        path: "/dashboard",
        email: "cliente@w3.com",
      },
    });

    expect(buildPostHogCapturePayload("phc_test", event)).toEqual({
      api_key: "phc_test",
      event: "dashboard_view",
      distinct_id: "user-1",
      properties: {
        workspaceId: "workspace-1",
        path: "/dashboard",
      },
    });
  });

  it("sanitizes client errors before reporting", () => {
    expect(
      buildSanitizedClientError({
        message: "Token abc failed for cliente@w3.com",
        stack: "Error: Token abc failed for cliente@w3.com\n    at fn",
        path: "/dashboard?access_token=secret",
        digest: "abc123",
      }),
    ).toEqual({
      message: "[redacted]",
      stack: "Error: [redacted]\n    at fn",
      path: "/dashboard",
      digest: "abc123",
    });
  });
});
