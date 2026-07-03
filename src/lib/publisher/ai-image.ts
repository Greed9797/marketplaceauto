/**
 * Geração de imagem via Gemini (BYOK). Usa o modelo gemini-2.5-flash-image no
 * MESMO endpoint :generateContent da copy, pedindo responseModalities
 * ['TEXT','IMAGE']. Suporta text→image e image+text→image (edição): quando uma
 * imagem base é passada, vai como inlineData junto do prompt. A imagem sai em
 * candidates[0].content.parts[].inlineData.data (base64) — o array de parts vem
 * MISTO (texto + imagem), então iteramos procurando a parte com inlineData.
 *
 * ATENÇÃO: geração de imagem é feature PAGA do Gemini — exige projeto com
 * billing habilitado na chave. O erro da API é propagado ao usuário.
 */
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

export type GeneratedImage = { base64: string; mimeType: string };

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
};

function extractImage(payload: unknown): GeneratedImage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return null;
  for (const candidate of candidates) {
    const parts = (candidate as { content?: { parts?: GeminiPart[] } }).content
      ?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const data = part.inlineData?.data;
      if (data) {
        return {
          base64: data,
          mimeType: part.inlineData?.mimeType || "image/png",
        };
      }
    }
  }
  return null;
}

/**
 * Gera uma imagem a partir de um prompt (e, opcionalmente, uma imagem base para
 * edição). Retorna base64 + mimeType. Lança erro amigável em falha.
 */
export async function gerarImagem(input: {
  apiKey: string;
  prompt: string;
  imagemBase64?: string | null;
  imagemMimeType?: string | null;
}): Promise<GeneratedImage> {
  const parts: GeminiPart[] = [{ text: input.prompt }];
  if (input.imagemBase64) {
    parts.push({
      inlineData: {
        mimeType: input.imagemMimeType || "image/jpeg",
        data: input.imagemBase64,
      },
    });
  }

  const response = await fetch(`${GEMINI_IMAGE_ENDPOINT}?key=${input.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // Billing desabilitado costuma vir como 400/403 — mensagem clara.
    if (response.status === 400 || response.status === 403) {
      throw new Error(
        "Falha na geração de imagem: verifique se a sua chave Gemini tem billing habilitado (recurso pago).",
      );
    }
    throw new Error(
      `Falha ao gerar imagem com Gemini (HTTP ${response.status}). ${detail.slice(0, 200)}`,
    );
  }

  const payload: unknown = await response.json();
  const image = extractImage(payload);
  if (!image) {
    throw new Error("Gemini não retornou imagem — tente um prompt diferente.");
  }
  return image;
}
