import { describe, expect, it, vi } from "vitest";

import { getOperationalHealth } from "@/lib/health/checks";

describe("operational health checks", () => {
  it("reports granular health without leaking configured secret values", async () => {
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([{ installed: true }]),
    };
    const fetchImpl = vi.fn(async () => Response.json({ result: null }));

    const health = await getOperationalHealth({
      prisma: prisma as never,
      fetchImpl: fetchImpl as never,
      env: {
        NODE_ENV: "production",
        AUTH_DISABLED: "false",
        INNGEST_EVENT_KEY: "inngest-event-secret",
        INNGEST_SIGNING_KEY: "inngest-signing-secret",
        UPSTASH_REDIS_REST_URL: "https://redis.example.com",
        UPSTASH_REDIS_REST_TOKEN: "redis-secret-token",
      },
      now: new Date("2026-05-18T12:00:00.000Z"),
    });

    expect(health.ok).toBe(true);
    expect(health.checks.database.ok).toBe(true);
    expect(health.checks.vault.ok).toBe(true);
    expect(health.checks.inngest.ok).toBe(true);
    expect(health.checks.redis.ok).toBe(true);
    expect(JSON.stringify(health)).not.toContain("secret");
  });

  it("marks production unhealthy when auth is disabled or infrastructure is missing", async () => {
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([{ installed: false }]),
    };

    const health = await getOperationalHealth({
      prisma: prisma as never,
      fetchImpl: vi.fn() as never,
      env: {
        NODE_ENV: "production",
        AUTH_DISABLED: "true",
      },
      now: new Date("2026-05-18T12:00:00.000Z"),
    });

    expect(health.ok).toBe(false);
    expect(health.checks.authMode).toMatchObject({ ok: false, status: "auth_disabled" });
    expect(health.checks.vault).toMatchObject({ ok: false, status: "not_installed" });
    expect(health.checks.inngest).toMatchObject({ ok: false, status: "not_configured" });
    expect(health.checks.redis).toMatchObject({ ok: false, status: "not_configured" });
  });
});
