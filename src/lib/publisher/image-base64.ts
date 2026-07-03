import { guardedRedirectFetch } from "@/lib/connectors/url-guard";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB — cabe no payload inline do Gemini

export type ImageBase64 = { base64: string; mimeType: string };

/**
 * Baixa uma imagem por URL pública e devolve base64 + mimeType, para enviar
 * como `inlineData` ao Gemini (copy multimodal / edição de imagem). Best-effort:
 * retorna null em qualquer falha (imagem é enriquecimento, não pode derrubar o
 * fluxo). Usa `redirectSafeFetch` (fail-closed em redirect) contra SSRF.
 */
export async function fetchImageAsBase64(
  url: string,
): Promise<ImageBase64 | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    const safeFetch = guardedRedirectFetch(fetch);
    const response = await safeFetch(parsed, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const mimeType = response.headers.get("content-type") || "image/jpeg";
    if (!mimeType.startsWith("image/")) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
    return {
      base64: Buffer.from(buffer).toString("base64"),
      mimeType: mimeType.split(";")[0].trim(),
    };
  } catch {
    return null;
  }
}
