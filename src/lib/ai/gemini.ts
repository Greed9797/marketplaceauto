const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";
const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
};

export class GeminiHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Gemini request failed (HTTP ${status}).`);
    this.name = "GeminiHttpError";
  }
}

export class GeminiEmptyResponseError extends Error {
  constructor() {
    super("Gemini returned an empty response.");
    this.name = "GeminiEmptyResponseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return "";

  const first = payload.candidates[0];
  if (!isRecord(first) || !isRecord(first.content)) return "";
  const parts = first.content.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}

function extractJson(text: string): string {
  const withoutFences = text.replace(/```(?:json)?/gi, "").trim();
  const objectStart = withoutFences.indexOf("{");
  const arrayStart = withoutFences.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length === 0) return withoutFences;

  const start = Math.min(...starts);
  const closing = withoutFences[start] === "{" ? "}" : "]";
  const end = withoutFences.lastIndexOf(closing);
  return end >= start ? withoutFences.slice(start, end + 1) : withoutFences;
}

export async function generateJson<T>(input: {
  prompt: string;
  apiKey?: string | null;
  model?: string | null;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  timeoutMs?: number;
}): Promise<{ data: T; raw: string }> {
  const apiKey = input.apiKey?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Chave de IA não configurada — cadastre sua chave Gemini em Configurações.",
    );
  }

  const model = input.model?.trim() || DEFAULT_GEMINI_MODEL;
  const parts: GeminiPart[] = [{ text: input.prompt }];
  if (input.imageBase64) {
    parts.push({
      inlineData: {
        mimeType: input.imageMimeType || "image/jpeg",
        data: input.imageBase64,
      },
    });
  }

  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(`${endpoint}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
  });

  if (!response.ok) throw new GeminiHttpError(response.status);

  const payload: unknown = await response.json();
  const raw = extractText(payload);
  if (!raw) throw new GeminiEmptyResponseError();

  return { data: JSON.parse(extractJson(raw)) as T, raw };
}
