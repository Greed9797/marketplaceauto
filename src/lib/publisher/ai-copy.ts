import type { Cliente, Produto } from "@prisma/client";

/**
 * Gemini generateContent REST endpoint. Called directly over `fetch` (no SDK
 * dependency) to keep the bundle lean and avoid adding a package for a single
 * call. Model mirrors the "auto" repo (`gemini-1.5-flash`).
 */
const GEMINI_MODEL = "gemini-1.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export type GeneratedCopy = {
  tituloMl: string;
  tituloShopee: string;
  descricao: string;
  categoriaMlSugerida: string;
  categoriaShopeeId: number;
  atributos: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parses the pipe-separated newline exemplos stored on the Cliente. */
function parseExemplos(raw: string | null): string[] {
  if (!raw) return [];

  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter(Boolean);
      }
    } catch {
      // Not JSON — fall through to newline splitting.
    }
  }

  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildPrompt(input: {
  nomeProduto: string;
  nicho: string;
  estiloDescricao: string;
  exemplosTitulos: string[];
  exemplosDescricoes: string[];
}): string {
  const titulos =
    input.exemplosTitulos.map((t, i) => `${i + 1}. ${t}`).join("\n") ||
    "Nenhum exemplo informado.";
  const descricoes =
    input.exemplosDescricoes.map((d, i) => `${i + 1}. ${d}`).join("\n") ||
    "Nenhum exemplo informado.";

  return `Você é especialista em e-commerce brasileiro. Gere anúncio para:

Produto: ${input.nomeProduto}
Nicho: ${input.nicho}
Estilo: ${input.estiloDescricao}

Exemplos de títulos que converteram:
${titulos}

Exemplos de descrições aprovadas:
${descricoes}

Retorne APENAS JSON válido, sem markdown, sem explicações:
{"titulo_ml":"...","titulo_shopee":"...","descricao":"...","categoria_ml_sugerida":"...","categoria_shopee_id":0,"atributos":{}}`;
}

/** Extracts the text part from a Gemini generateContent response. */
function extractText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const candidates = payload.candidates;
  if (!Array.isArray(candidates)) return "";
  const first = candidates[0];
  if (!isRecord(first)) return "";
  const content = first.content;
  if (!isRecord(content)) return "";
  const parts = content.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}

/** Strips markdown fences and coerces the model JSON into GeneratedCopy. */
function parseCopy(text: string): GeneratedCopy {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const parsed: unknown = JSON.parse(cleaned);
  const record = isRecord(parsed) ? parsed : {};

  const rawAtributos = isRecord(record.atributos) ? record.atributos : {};
  const atributos: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawAtributos)) {
    atributos[key] = String(value);
  }

  return {
    tituloMl: String(record.titulo_ml ?? "").slice(0, 60),
    tituloShopee: String(record.titulo_shopee ?? "").slice(0, 120),
    descricao: String(record.descricao ?? ""),
    categoriaMlSugerida: String(record.categoria_ml_sugerida ?? "Outros"),
    categoriaShopeeId: Number(record.categoria_shopee_id ?? 0),
    atributos,
  };
}

/**
 * Generates marketplace copy (title + description + suggested categories) for a
 * product, grounded in the Cliente's niche, style and past-winning examples.
 * Throws a friendly error when `GEMINI_API_KEY` is not configured.
 */
export async function gerarCopy(input: {
  cliente: Pick<
    Cliente,
    "nicho" | "estiloDescricao" | "exemplosTitulos" | "exemplosDescricoes"
  >;
  produto: Pick<Produto, "nomeOriginal">;
  /** Chave BYOK do workspace (resolveAiKey). Sem ela, cai no env global. */
  apiKey?: string | null;
  /** Imagem do produto (base64 sem prefixo data:) para prompt multimodal. */
  imagemBase64?: string | null;
  imagemMimeType?: string | null;
}): Promise<GeneratedCopy> {
  const apiKey = input.apiKey?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Chave de IA não configurada — cadastre sua chave Gemini em Configurações.",
    );
  }

  const prompt = buildPrompt({
    nomeProduto: input.produto.nomeOriginal,
    nicho: input.cliente.nicho ?? "",
    estiloDescricao: input.cliente.estiloDescricao ?? "",
    exemplosTitulos: parseExemplos(input.cliente.exemplosTitulos),
    exemplosDescricoes: parseExemplos(input.cliente.exemplosDescricoes),
  });

  // Multimodal: quando há imagem, envia foto + texto (Gemini Flash é
  // multimodal) para enriquecer título/descrição/atributos com o que aparece
  // na foto. Sem imagem, é texto puro como antes.
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (input.imagemBase64) {
    parts.push({
      inlineData: {
        mimeType: input.imagemMimeType || "image/jpeg",
        data: input.imagemBase64,
      },
    });
  }

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Falha ao gerar copy com Gemini (HTTP ${response.status}).`,
    );
  }

  const payload: unknown = await response.json();
  const text = extractText(payload);
  if (!text) {
    throw new Error("Gemini retornou resposta vazia.");
  }

  return parseCopy(text);
}
