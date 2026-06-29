"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import {
  buildAnalyticsEvent,
  buildPostHogCapturePayload,
  buildSanitizedClientError,
  getPostHogConfig,
  type AnalyticsEvent,
} from "@/lib/observability/analytics";

function sendPostHogEvent(event: AnalyticsEvent) {
  const config = getPostHogConfig({
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });

  if (!config) {
    return;
  }

  void fetch(`${config.host}/capture/`, {
    method: "POST",
    keepalive: true,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(buildPostHogCapturePayload(config.apiKey, event)),
  }).catch(() => undefined);
}

function reportClientError(input: { message: string; stack?: string; digest?: string; path: string }) {
  void fetch("/api/observability/client-error", {
    method: "POST",
    keepalive: true,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(buildSanitizedClientError(input)),
  }).catch(() => undefined);
}

export function AnalyticsProvider({
  userId,
  workspaceId,
}: {
  userId: string;
  workspaceId?: string;
}) {
  const pathname = usePathname();

  useEffect(() => {
    const event = buildAnalyticsEvent({
      name: "dashboard_view",
      userId,
      workspaceId,
      properties: {
        path: pathname,
      },
    });

    window.dispatchEvent(new CustomEvent("adstartw3:analytics", { detail: event }));
    sendPostHogEvent(event);
  }, [pathname, userId, workspaceId]);

  useEffect(() => {
    const handleAnalyticsEvent = (event: Event) => {
      if (event instanceof CustomEvent) {
        sendPostHogEvent(event.detail as AnalyticsEvent);
      }
    };

    const handleError = (event: ErrorEvent) => {
      reportClientError({
        message: event.message,
        stack: event.error instanceof Error ? event.error.stack : undefined,
        path: window.location.pathname,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportClientError({
        message: reason instanceof Error ? reason.message : "Unhandled promise rejection",
        stack: reason instanceof Error ? reason.stack : undefined,
        path: window.location.pathname,
      });
    };

    window.addEventListener("adstartw3:analytics", handleAnalyticsEvent);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("adstartw3:analytics", handleAnalyticsEvent);
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
