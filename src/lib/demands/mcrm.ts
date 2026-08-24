import "server-only";

import { randomUUID } from "node:crypto";

import { assertPublicHttpUrl } from "@/lib/connectors/url-guard";

const MAX_RESPONSE_BYTES = 512 * 1024;

type JsonRpcResponse = {
  error?: { code?: number; message?: string };
  result?: {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
  };
};

export class McrmClientError extends Error {
  constructor(
    public readonly code:
      | "invalid_url"
      | "http_error"
      | "invalid_response"
      | "mcp_error"
      | "network_error",
    message: string,
  ) {
    super(message);
    this.name = "McrmClientError";
  }
}

export function parseMcrmStreamableResponse(body: string): JsonRpcResponse {
  const trimmed = body.trim();
  const candidates = trimmed.startsWith("{")
    ? [trimmed]
    : trimmed
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((line) => line && line !== "[DONE]");

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as unknown;
      if (value && typeof value === "object") return value as JsonRpcResponse;
    } catch {
      // Continue until a valid JSON or SSE frame is found.
    }
  }
  throw new McrmClientError("invalid_response", "O MCRM respondeu em um formato inválido.");
}

function extractMcrmResult(envelope: JsonRpcResponse): Record<string, unknown> {
  if (envelope.error) {
    throw new McrmClientError(
      "mcp_error",
      `O MCRM recusou a operação (código ${envelope.error.code ?? "desconhecido"}).`,
    );
  }
  if (envelope.result?.isError) {
    throw new McrmClientError("mcp_error", "O MCRM não conseguiu enviar a mensagem.");
  }

  for (const item of envelope.result?.content ?? []) {
    if (item.type !== "text" || !item.text) continue;
    try {
      const value = JSON.parse(item.text) as unknown;
      if (value && typeof value === "object") return value as Record<string, unknown>;
    } catch {
      // Text blocks that are not JSON are not valid send confirmations.
    }
  }
  throw new McrmClientError("invalid_response", "O MCRM não confirmou o envio.");
}

function buildMcrmEndpoint(baseUrl: string): URL {
  let endpoint: URL;
  try {
    endpoint = assertPublicHttpUrl(baseUrl);
  } catch (error) {
    throw new McrmClientError(
      "invalid_url",
      error instanceof Error ? error.message : "URL do MCRM inválida.",
    );
  }
  if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:") {
    throw new McrmClientError("invalid_url", "O MCRM precisa usar HTTPS em produção.");
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/api/mcp`;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

export async function sendMcrmWhatsapp(input: {
  baseUrl: string;
  token: string;
  conversationId: string;
  body: string;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const endpoint = buildMcrmEndpoint(input.baseUrl);
  const payload = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "tools/call",
    params: {
      name: "crm_send_whatsapp_message",
      arguments: {
        conversation_id: input.conversationId,
        body: input.body,
        type: "text",
        idempotency_key: input.idempotencyKey,
      },
    },
  };

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new McrmClientError("network_error", "Não foi possível alcançar o MCRM.");
  }

  if (!response.ok) {
    throw new McrmClientError("http_error", `O MCRM respondeu com status ${response.status}.`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new McrmClientError("invalid_response", "A resposta do MCRM excedeu o limite seguro.");
  }
  const rawBody = await response.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_RESPONSE_BYTES) {
    throw new McrmClientError("invalid_response", "A resposta do MCRM excedeu o limite seguro.");
  }
  return extractMcrmResult(parseMcrmStreamableResponse(rawBody));
}
