/**
 * `redirect()`/`notFound()` from Next throw a control-flow error tagged with a
 * `digest`. OAuth route handlers wrap their body in try/catch to turn real
 * failures into a friendly `/connectors?error=...` redirect instead of a raw
 * HTTP 500 — but those control-flow errors must be re-thrown so Next can
 * complete the navigation. Use this to tell them apart.
 */
export function isNextControlFlowError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}
