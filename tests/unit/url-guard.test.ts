import { describe, expect, it } from "vitest";

import {
  assertPublicHttpUrl,
  guardedRedirectFetch,
} from "@/lib/connectors/url-guard";

function jsonResponse(status: number, location?: string) {
  return new Response(status >= 300 && status < 400 ? null : "ok", {
    status,
    headers: location ? { location } : undefined,
  });
}

describe("assertPublicHttpUrl", () => {
  it("accepts public http(s) hosts", () => {
    expect(assertPublicHttpUrl("https://api.tray.com.br").host).toBe(
      "api.tray.com.br",
    );
    expect(assertPublicHttpUrl("loja.example.com").protocol).toBe("https:");
    expect(assertPublicHttpUrl("http://203.0.113.10/api").hostname).toBe(
      "203.0.113.10",
    );
  });

  it("rejects non-http(s) protocols", () => {
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow();
    expect(() => assertPublicHttpUrl("gopher://evil/x")).toThrow();
  });

  it("rejects loopback and internal hostnames", () => {
    expect(() => assertPublicHttpUrl("http://localhost:3000")).toThrow();
    expect(() => assertPublicHttpUrl("http://db.internal/orders")).toThrow();
    expect(() => assertPublicHttpUrl("http://api.local")).toThrow();
  });

  it("rejects private and metadata IPv4 ranges", () => {
    expect(() => assertPublicHttpUrl("http://127.0.0.1")).toThrow();
    expect(() => assertPublicHttpUrl("http://10.1.2.3")).toThrow();
    expect(() => assertPublicHttpUrl("http://172.16.5.5")).toThrow();
    expect(() => assertPublicHttpUrl("http://192.168.0.1")).toThrow();
    expect(() =>
      assertPublicHttpUrl("http://169.254.169.254/latest/meta-data"),
    ).toThrow();
    expect(() => assertPublicHttpUrl("http://0.0.0.0")).toThrow();
  });

  it("rejects loopback and link-local IPv6", () => {
    expect(() => assertPublicHttpUrl("http://[::1]")).toThrow();
    expect(() => assertPublicHttpUrl("http://[fe80::1]")).toThrow();
    expect(() => assertPublicHttpUrl("http://[fc00::1]")).toThrow();
    expect(() => assertPublicHttpUrl("http://[::ffff:127.0.0.1]")).toThrow();
  });
});

describe("guardedRedirectFetch", () => {
  it("follows a public redirect chain (Google Sheets export → googleusercontent)", async () => {
    const seen: string[] = [];
    const impl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = input.toString();
      seen.push(url);
      if (url.includes("docs.google.com")) {
        return jsonResponse(
          307,
          "https://doc-08-4o-sheets.googleusercontent.com/export/abc",
        );
      }
      return jsonResponse(200);
    }) as typeof fetch;

    const res = await guardedRedirectFetch(impl)(
      "https://docs.google.com/spreadsheets/d/ID/export?format=csv",
    );
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("googleusercontent.com");
  });

  it("blocks a redirect to a private/metadata host (SSRF)", async () => {
    const impl = (async () =>
      jsonResponse(302, "http://169.254.169.254/latest/meta-data")) as typeof fetch;

    await expect(
      guardedRedirectFetch(impl)("https://docs.google.com/export"),
    ).rejects.toThrow();
  });

  it("returns a non-redirect response directly", async () => {
    const impl = (async () => jsonResponse(200)) as typeof fetch;
    const res = await guardedRedirectFetch(impl)("https://docs.google.com/x");
    expect(res.status).toBe(200);
  });

  it("stops after too many redirects", async () => {
    // Always redirects to another public host → must bail, not loop forever.
    const impl = (async () =>
      jsonResponse(307, "https://a.example.com/next")) as typeof fetch;
    await expect(
      guardedRedirectFetch(impl, 2)("https://docs.google.com/x"),
    ).rejects.toThrow(/excesso/);
  });
});
