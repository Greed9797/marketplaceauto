/**
 * Detect whether Inngest is functionally configured.
 *
 * In production we sometimes deploy with placeholder keys (e.g. CI bootstrap,
 * dev preview deploys). When the keys are placeholders, no Inngest worker
 * consumes events, so we need to run syncs inline as a fallback.
 */
export function isInngestConfigured(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean {
  const eventKey = env.INNGEST_EVENT_KEY?.trim() ?? "";
  const signingKey = env.INNGEST_SIGNING_KEY?.trim() ?? "";

  if (!eventKey || !signingKey) {
    return false;
  }

  if (eventKey.includes("placeholder") || signingKey.includes("placeholder")) {
    return false;
  }

  return true;
}
