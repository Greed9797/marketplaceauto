import { describe, expect, it } from "vitest";

import { humanizePublishError } from "./humanize-publish-error";

describe("humanizePublishError", () => {
  it("parses ML cause[] and maps missing attribute", () => {
    const raw = JSON.stringify({
      message: "Validation error",
      cause: [
        {
          code: "item.attributes.required",
          message: "The attribute BRAND is required",
        },
      ],
    });
    const r = humanizePublishError(raw);
    expect(r.title).toBe("Falta um atributo obrigatório");
    expect(r.detail).toBe(raw);
  });

  it("maps Shopee weight/dimension error", () => {
    const r = humanizePublishError(
      "Shopee API error: package_length is required",
    );
    expect(r.title).toBe("Peso ou dimensões faltando");
  });

  it("maps expired token", () => {
    const r = humanizePublishError("401 Unauthorized: token expired");
    expect(r.title).toBe("Conexão expirada");
  });

  it("falls back for unknown errors", () => {
    const r = humanizePublishError("weird boom");
    expect(r.title).toBe("Falha ao publicar");
    expect(r.detail).toBe("weird boom");
  });

  it("handles null", () => {
    const r = humanizePublishError(null);
    expect(r.detail).toBe("Erro desconhecido.");
  });
});
