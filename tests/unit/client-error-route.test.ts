import { NextRequest } from "next/server";
import { describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "test-user" } })),
}));

vi.mock("@/lib/audit/log", () => ({
  logAudit: vi.fn(async () => undefined),
}));

import { auth } from "@/lib/auth/auth";
import { POST } from "@/app/api/observability/client-error/route";

// auth() do Auth.js tem overloads que o vi.mocked não consegue estreitar.
const mockAuth = auth as unknown as Mock;

function buildRequest(body: unknown) {
  return new NextRequest("http://localhost/api/observability/client-error", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/observability/client-error", () => {
  it("rejects anonymous ingests with 401", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const response = await POST(buildRequest({ message: "boom" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  it("accepts and sanitizes valid client errors", async () => {
    const request = buildRequest({
      message: "Token abc failed for cliente@w3.com",
      path: "/dashboard?access_token=secret",
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects invalid payloads", async () => {
    const response = await POST(buildRequest({ message: "" }));

    expect(response.status).toBe(400);
  });
});
