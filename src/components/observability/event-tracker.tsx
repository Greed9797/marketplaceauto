"use client";

import { useEffect } from "react";

import { buildAnalyticsEvent, type AnalyticsEventName } from "@/lib/observability/analytics";

type EventTrackerProps = {
  name: AnalyticsEventName;
  userId: string;
  workspaceId?: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
};

export function EventTracker({ name, userId, workspaceId, properties }: EventTrackerProps) {
  useEffect(() => {
    const event = buildAnalyticsEvent({
      name,
      userId,
      workspaceId,
      properties,
    });
    const timeoutId = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("adstartw3:analytics", { detail: event }));
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [name, properties, userId, workspaceId]);

  return null;
}
