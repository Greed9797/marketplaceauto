import { describe, expect, it } from "vitest";

import {
  forgotPasswordSchema,
  loginSchema,
  signUpSchema,
  workspaceInviteSchema,
} from "@/lib/auth/schemas";

describe("auth form schemas", () => {
  it("normalizes signup email and workspace name", () => {
    const parsed = signUpSchema.parse({
      name: "Ana Silva",
      email: " ANA@EXAMPLE.COM ",
      password: "senha-segura-123",
      workspaceName: "  W3 Store  ",
      acceptedTerms: "on",
    });

    expect(parsed.email).toBe("ana@example.com");
    expect(parsed.workspaceName).toBe("W3 Store");
    expect(parsed.acceptedTerms).toBe(true);
  });

  it("rejects signup without LGPD consent", () => {
    expect(() =>
      signUpSchema.parse({
        name: "Ana Silva",
        email: "ana@example.com",
        password: "senha-segura-123",
        workspaceName: "W3 Store",
      }),
    ).toThrow();
  });

  it("validates login credentials", () => {
    const parsed = loginSchema.parse({
      email: " dono@w3.com.br ",
      password: "senha-segura-123",
    });

    expect(parsed.email).toBe("dono@w3.com.br");
  });

  it("validates password reset and invite payloads", () => {
    expect(forgotPasswordSchema.parse({ email: "Pessoa@W3.com.br" }).email).toBe(
      "pessoa@w3.com.br",
    );

    expect(
      workspaceInviteSchema.parse({
        email: "viewer@w3.com.br",
        role: "VIEWER",
      }),
    ).toEqual({ email: "viewer@w3.com.br", role: "VIEWER" });
  });
});
