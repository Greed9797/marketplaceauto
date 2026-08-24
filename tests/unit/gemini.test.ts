import { afterEach, describe, expect, it, vi } from "vitest";

import { generateJson } from "@/lib/ai/gemini";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("generateJson", () => {
  it("normaliza fences e ruido ao redor do JSON (KIT-01)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'Resultado:\n```json\n{"gender":"unissex"}\n```\nFim.',
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateJson<{ gender: string }>({
      apiKey: "test-key",
      prompt: "Classifique o produto",
    });

    expect(result.data).toEqual({ gender: "unissex" });
    expect(result.raw).toContain('```json\n{"gender":"unissex"}');
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=test-key",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});
