import { afterEach, describe, expect, it, vi } from "vitest";

import { getDevBypassEmail } from "@/lib/auth/mode";

describe("auth mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns DEV_AUTH_BYPASS_EMAIL only outside production", () => {
    vi.stubEnv("DEV_AUTH_BYPASS_EMAIL", "admin@w3ads.local");

    vi.stubEnv("NODE_ENV", "development");
    expect(getDevBypassEmail()).toBe("admin@w3ads.local");

    vi.stubEnv("NODE_ENV", "production");
    expect(getDevBypassEmail()).toBeNull();
  });

  it("returns null when bypass email is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH_BYPASS_EMAIL", "");

    expect(getDevBypassEmail()).toBeNull();
  });
});
