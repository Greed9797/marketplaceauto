import { describe, expect, it, vi } from "vitest";

import {
  McrmClientError,
  parseMcrmStreamableResponse,
  sendMcrmWhatsapp,
} from "@/lib/demands/mcrm";

function rpcBody(result: Record<string, unknown>) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: "response-1",
    result: { content: [{ type: "text", text: JSON.stringify(result) }] },
  });
}

describe("MCRM demand notifications", () => {
  it("parses JSON and SSE streamable responses", () => {
    expect(parseMcrmStreamableResponse(rpcBody({ message_id: "m1" })).result).toBeDefined();
    expect(
      parseMcrmStreamableResponse(`event: message\ndata: ${rpcBody({ message_id: "m2" })}\n\n`).result,
    ).toBeDefined();
  });

  it("sends the MCP tool with an idempotency key", async () => {
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.method).toBe("tools/call");
      expect(payload.params.arguments).toMatchObject({
        conversation_id: "1d3ef47e-5df0-4c3a-b322-6dddcb10a525",
        idempotency_key: "demand-alert:alert-1",
      });
      expect(init?.redirect).toBe("error");
      return new Response(rpcBody({ message_id: "message-1", status: "sending" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await sendMcrmWhatsapp({
      baseUrl: "https://mcrm.example.com",
      token: "secret-bearer-that-must-not-leak",
      conversationId: "1d3ef47e-5df0-4c3a-b322-6dddcb10a525",
      body: "Alerta de demanda",
      idempotencyKey: "demand-alert:alert-1",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.message_id).toBe("message-1");
  });

  it("returns a generic HTTP error without exposing token or response body", async () => {
    const token = "secret-bearer-that-must-not-leak";
    const fetchImpl = vi.fn(async () => new Response(`echo ${token}`, { status: 500 }));
    const promise = sendMcrmWhatsapp({
      baseUrl: "https://mcrm.example.com",
      token,
      conversationId: "1d3ef47e-5df0-4c3a-b322-6dddcb10a525",
      body: "Alerta de demanda",
      idempotencyKey: "demand-alert:alert-2",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(promise).rejects.toBeInstanceOf(McrmClientError);
    await expect(promise).rejects.not.toThrow(token);
  });
});
