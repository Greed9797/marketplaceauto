import net from "node:net";

/**
 * SSRF guard for user-supplied connector URLs.
 *
 * Manual commerce connectors let an authenticated user store a `baseUrl` that
 * the server later `fetch()`es. Without a guard, that URL can point at
 * `localhost`, a private RFC1918 host, or the cloud metadata endpoint
 * (169.254.169.254), turning the sync worker into an SSRF proxy.
 *
 * This validates the URL LITERAL (the textual host). It deliberately does NOT
 * resolve DNS — a public hostname that resolves to a private IP (DNS rebinding)
 * is out of scope and would need a pinned-lookup fetch agent. The finding this
 * closes is private/loopback/metadata IPs and internal hostnames saved directly
 * in `baseUrl`.
 */

const BLOCKED_HOST_SUFFIXES = [".localhost", ".internal", ".local"];

/**
 * Prefix a bare host with https:// so `new URL` can parse it. A string that
 * already carries ANY scheme (http, file, gopher, …) is left untouched so the
 * protocol check downstream can reject non-http(s) schemes.
 */
export function ensureHttpProtocol(raw: string): string {
  const trimmed = raw.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

function ipv4ToOctets(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1, 5).map((part) => Number(part));
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

function isBlockedIpv6(host: string): boolean {
  // `new URL` may keep IPv6 brackets in some host forms; strip them.
  const h = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fe80")) return true; // link-local fe80::/10
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  // IPv4-mapped (::ffff:…) — `new URL` may normalize the trailing IPv4 to hex
  // groups (::ffff:7f00:1), so block the whole mapped range conservatively; a
  // mapped address never legitimately appears in a store base URL.
  if (h.startsWith("::ffff:")) return true;
  return false;
}

/**
 * Throws if `raw` is not a public http(s) URL. Returns the parsed `URL` on
 * success so callers can reuse it.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(ensureHttpProtocol(raw));
  } catch {
    throw new Error("URL inválida.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL não permitida: apenas http(s) é aceito.");
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "" ||
    host === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw new Error(
      "URL não permitida: endereço interno ou privado bloqueado por segurança.",
    );
  }

  const ipKind = net.isIP(host.replace(/^\[/, "").replace(/\]$/, ""));
  if (ipKind === 4) {
    const octets = ipv4ToOctets(host);
    if (!octets || isPrivateIpv4(octets)) {
      throw new Error(
        "URL não permitida: endereço interno ou privado bloqueado por segurança.",
      );
    }
  } else if (ipKind === 6) {
    if (isBlockedIpv6(host)) {
      throw new Error(
        "URL não permitida: endereço interno ou privado bloqueado por segurança.",
      );
    }
  }

  return url;
}

/**
 * Wraps a fetch implementation so every request fails closed on redirects.
 * `assertPublicHttpUrl` only validates the URL literal at call time, but
 * `fetch` follows 3xx redirects by default — a public host the guard accepts
 * could redirect to a private/metadata address. Forcing `redirect: "error"`
 * turns any redirect into a thrown error, closing that SSRF bypass. Commerce
 * REST APIs return data directly (and base URLs are already normalized to
 * https), so legitimate syncs do not rely on redirects.
 */
export function redirectSafeFetch(impl: typeof fetch): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    impl(input, { ...init, redirect: "error" })) as typeof fetch;
}

/**
 * Like {@link redirectSafeFetch} but FOLLOWS redirects while re-validating every
 * hop with {@link assertPublicHttpUrl}. Google Sheets' CSV export
 * (`docs.google.com/.../export?format=csv`) 307-redirects to a
 * `*.googleusercontent.com` download URL, so the fail-closed `redirect: "error"`
 * policy throws ("fetch failed: unexpected redirect") and breaks every Sheets
 * sync. This follows the chain but still blocks a hop to a private/metadata host
 * (SSRF), unlike a plain `redirect: "follow"`.
 */
export function guardedRedirectFetch(
  impl: typeof fetch,
  maxRedirects = 5,
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    let target =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      assertPublicHttpUrl(target);
      const response = await impl(target, { ...init, redirect: "manual" });
      const location =
        response.status >= 300 && response.status < 400
          ? response.headers.get("location")
          : null;
      if (!location) {
        return response;
      }
      // Resolve relative Locations against the current hop, then re-guard.
      target = new URL(location, target).href;
    }

    throw new Error("URL não permitida: redirecionamentos em excesso.");
  }) as typeof fetch;
}
