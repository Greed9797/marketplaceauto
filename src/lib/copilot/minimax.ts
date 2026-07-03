/**
 * Cliente do MiniMax M3 (multimodal) — o cérebro do copiloto-chat (Onda 3+).
 * Endpoint OpenAI-compatible da MiniMax. M3 é fixo por decisão do produto
 * (multimodal + tool-calling); só a chave e a base URL são configuráveis.
 */
const MINIMAX_BASE_URL =
  process.env.MINIMAX_BASE_URL?.trim() || "https://api.minimax.io/v1";
const MINIMAX_MODEL = "MiniMax-M3";

/** Parte de conteúdo multimodal (texto ou imagem), formato OpenAI. */
export type MiniMaxContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type MiniMaxMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | MiniMaxContentPart[];
  tool_calls?: MiniMaxToolCall[];
  tool_call_id?: string;
};

export type MiniMaxToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type MiniMaxTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type MiniMaxReply = {
  content: string;
  toolCalls: MiniMaxToolCall[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Uma rodada de chat com M3. Retorna texto e/ou tool_calls propostos. */
export async function minimaxChat(input: {
  messages: MiniMaxMessage[];
  tools?: MiniMaxTool[];
}): Promise<MiniMaxReply> {
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Copiloto indisponível — configure MINIMAX_API_KEY no ambiente.",
    );
  }

  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      messages: input.messages,
      ...(input.tools?.length
        ? { tools: input.tools, tool_choice: "auto" }
        : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`MiniMax HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const payload: unknown = await response.json();
  const choice =
    isRecord(payload) && Array.isArray(payload.choices)
      ? payload.choices[0]
      : null;
  const message =
    isRecord(choice) && isRecord(choice.message) ? choice.message : null;

  const rawContent =
    message && typeof message.content === "string" ? message.content : "";
  // M3 embute o raciocínio em <think>…</think> — remove antes de exibir.
  const content = rawContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const toolCalls =
    message && Array.isArray(message.tool_calls)
      ? (message.tool_calls as MiniMaxToolCall[])
      : [];

  return { content, toolCalls };
}
