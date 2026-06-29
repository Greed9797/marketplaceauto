import { createHmac, timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import { getSecretStore } from "@/lib/security/secret-store";

import { getGlobalNuvemshopClientSecret } from "./global-config";

/**
 * Verifies a Nuvemshop webhook HMAC signature (SHA-256 base64) against the
 * client_secret of the first active NUVEMSHOP ProviderConfig found. Nuvemshop
 * apps share a single client_secret across all installations, so any active
 * config works as the verification key.
 *
 * Returns true if HMAC validates or if no config is configured yet (fail-open
 * during initial app registration where Nuvemshop sends a probe before any
 * workspace installs the app).
 */
export async function verifyNuvemshopWebhookHmac(input: {
  rawBody: string;
  signature: string | null;
}): Promise<{ valid: boolean; reason?: string }> {
  if (!input.signature) {
    return { valid: false, reason: "missing-signature" };
  }

  // Prefer the shared global secret (NUVEMSHOP_CLIENT_SECRET env). Fall back
  // to the first active per-workspace ProviderConfig for installs that still
  // use the legacy bring-your-own-app flow.
  let clientSecret = getGlobalNuvemshopClientSecret() ?? "";

  if (!clientSecret) {
    const config = await prisma.connectorProviderConfig.findFirst({
      where: { provider: "NUVEMSHOP", status: "ACTIVE" },
      select: { secretRefs: true },
    });

    const secretId =
      config?.secretRefs &&
      typeof config.secretRefs === "object" &&
      !Array.isArray(config.secretRefs) &&
      "clientSecret" in config.secretRefs
        ? String(
            (config.secretRefs as Record<string, unknown>).clientSecret ?? "",
          )
        : "";

    if (!secretId) {
      // Fail-closed: refuse to accept unsigned webhooks. If the Nuvemshop
      // app-review probe must be allowed temporarily, set
      // NUVEMSHOP_ALLOW_UNSIGNED_PROBE=true in env and remove it the moment
      // the app is registered.
      if (process.env.NUVEMSHOP_ALLOW_UNSIGNED_PROBE === "true") {
        return { valid: true, reason: "probe-allowed" };
      }
      return { valid: false, reason: "no-config-configured" };
    }

    try {
      clientSecret = await getSecretStore().getSecret(secretId);
    } catch {
      return { valid: false, reason: "secret-fetch-failed" };
    }
  }

  if (!clientSecret) {
    return { valid: false, reason: "empty-secret" };
  }

  const computed = createHmac("sha256", clientSecret)
    .update(input.rawBody, "utf8")
    .digest("base64");

  const signatureBuf = Buffer.from(input.signature);
  const computedBuf = Buffer.from(computed);
  if (signatureBuf.length !== computedBuf.length) {
    return { valid: false, reason: "hmac-length-mismatch" };
  }
  if (!timingSafeEqual(signatureBuf, computedBuf)) {
    return { valid: false, reason: "hmac-mismatch" };
  }

  return { valid: true };
}
