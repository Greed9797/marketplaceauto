import { describe, expect, it } from "vitest";

import {
  canUseAccountTimer,
  canViewAccountTimerLogs,
} from "@/lib/auth/permissions";
import { computeDurationSeconds, formatDuration } from "@/lib/timer/duration";

describe("canUseAccountTimer", () => {
  it("allows internal W3 managers only", () => {
    expect(canUseAccountTimer({ platformRole: "TRAFFIC_MANAGER" })).toBe(true);
    expect(canUseAccountTimer({ platformRole: "ADMIN_LIMITED" })).toBe(true);
    expect(canUseAccountTimer({ platformRole: "ADMIN_MASTER" })).toBe(true);
    expect(canUseAccountTimer({ platformRole: "W3_ADMIN" })).toBe(true);
  });

  it("blocks plain platform users", () => {
    expect(canUseAccountTimer({ platformRole: "USER" })).toBe(false);
  });
});

describe("canViewAccountTimerLogs", () => {
  it("lets Admin Master see logs regardless of membership role", () => {
    expect(
      canViewAccountTimerLogs({ platformRole: "ADMIN_MASTER" }, null),
    ).toBe(true);
    expect(
      canViewAccountTimerLogs({ platformRole: "W3_ADMIN" }, "VIEWER"),
    ).toBe(true);
  });

  it("lets the workspace OWNER see their brand's logs", () => {
    expect(canViewAccountTimerLogs({ platformRole: "USER" }, "OWNER")).toBe(
      true,
    );
  });

  it("denies non-owner members and outsiders", () => {
    expect(canViewAccountTimerLogs({ platformRole: "USER" }, "ADMIN")).toBe(
      false,
    );
    expect(canViewAccountTimerLogs({ platformRole: "USER" }, "VIEWER")).toBe(
      false,
    );
    expect(canViewAccountTimerLogs({ platformRole: "USER" }, "CLIENT")).toBe(
      false,
    );
    expect(canViewAccountTimerLogs({ platformRole: "USER" }, null)).toBe(false);
    // Gestor de Contas is NOT an admin master and has no real OWNER membership.
    expect(
      canViewAccountTimerLogs({ platformRole: "ADMIN_LIMITED" }, null),
    ).toBe(false);
  });
});

describe("computeDurationSeconds", () => {
  it("rounds elapsed seconds and never goes negative", () => {
    const start = new Date("2026-06-23T10:00:00.000Z");
    expect(
      computeDurationSeconds(start, new Date("2026-06-23T10:00:30.400Z")),
    ).toBe(30);
    expect(
      computeDurationSeconds(start, new Date("2026-06-23T11:30:00.000Z")),
    ).toBe(5400);
    // Clock skew / out-of-order timestamps clamp to 0, not a negative log.
    expect(
      computeDurationSeconds(start, new Date("2026-06-23T09:59:00.000Z")),
    ).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats as HH:MM:SS and grows past 24h", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(5)).toBe("00:00:05");
    expect(formatDuration(3661)).toBe("01:01:01");
    expect(formatDuration(90000)).toBe("25:00:00");
  });
});
