import { describe, expect, it } from "vitest";

import {
  buildUserDataExport,
  maskEmail,
  validateDeleteConfirmation,
} from "@/lib/compliance/lgpd";

describe("LGPD helpers", () => {
  it("masks emails before putting them in free-form logs", () => {
    expect(maskEmail("joao.silva@gmail.com")).toBe("j***a@gmail.com");
    expect(maskEmail("a@w3.com")).toBe("a***@w3.com");
  });

  it("builds a stable user data export payload", () => {
    const payload = buildUserDataExport({
      user: {
        id: "user-1",
        email: "cliente@w3.com",
        name: "Cliente W3",
      },
      workspaces: [
        {
          id: "workspace-1",
          name: "Loja W3",
          role: "OWNER",
        },
      ],
      generatedAt: new Date("2026-05-16T12:00:00.000Z"),
    });

    expect(payload).toEqual({
      generatedAt: "2026-05-16T12:00:00.000Z",
      user: {
        id: "user-1",
        email: "cliente@w3.com",
        name: "Cliente W3",
      },
      workspaces: [
        {
          id: "workspace-1",
          name: "Loja W3",
          role: "OWNER",
        },
      ],
    });
  });

  it("requires exact email confirmation for destructive account deletion", () => {
    expect(validateDeleteConfirmation("cliente@w3.com", "cliente@w3.com")).toBe(true);
    expect(validateDeleteConfirmation("cliente@w3.com", "CLIENTE@w3.com")).toBe(false);
    expect(validateDeleteConfirmation("cliente@w3.com", "outro@w3.com")).toBe(false);
  });
});
