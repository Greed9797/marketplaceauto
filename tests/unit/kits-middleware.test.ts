import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rateLimitMiddlewareMock } = vi.hoisted(() => ({
  rateLimitMiddlewareMock: vi.fn(),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  rateLimitMiddleware: rateLimitMiddlewareMock,
}));

import { middleware } from "@/middleware";

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMiddlewareMock.mockResolvedValue(null);
});

describe("middleware /kits", () => {
  it("redireciona visitante sem sessao para login", async () => {
    const response = await middleware(new NextRequest("http://localhost/kits"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?callbackUrl=%2Fkits",
    );
    expect(rateLimitMiddlewareMock).not.toHaveBeenCalled();
  });
});
