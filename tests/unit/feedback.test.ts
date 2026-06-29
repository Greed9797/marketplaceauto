import { describe, expect, it } from "vitest";

import { parseFeedbackFormData } from "@/lib/feedback/schema";

function formDataFrom(values: Record<string, string>) {
  const formData = new FormData();

  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }

  return formData;
}

describe("feedback schema", () => {
  it("normalizes valid beta feedback", () => {
    const result = parseFeedbackFormData(
      formDataFrom({
        type: "BUG",
        message: "  O dashboard nao atualizou depois de trocar o periodo.  ",
        pagePath: "/dashboard?period=30d",
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("expected feedback to parse");
    }
    expect(result.data).toEqual({
      type: "BUG",
      message: "O dashboard nao atualizou depois de trocar o periodo.",
      pagePath: "/dashboard?period=30d",
    });
  });

  it("rejects empty or too short feedback", () => {
    const result = parseFeedbackFormData(
      formDataFrom({
        type: "SUGGESTION",
        message: "curto",
        pagePath: "/dashboard",
      }),
    );

    expect(result.success).toBe(false);
  });

  it("drops external page paths from feedback payloads", () => {
    const result = parseFeedbackFormData(
      formDataFrom({
        type: "QUESTION",
        message: "Quero entender melhor como sera feita a conciliacao de pedidos.",
        pagePath: "https://example.com/phishing",
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("expected feedback to parse");
    }
    expect(result.data?.pagePath).toBeUndefined();
  });
});
