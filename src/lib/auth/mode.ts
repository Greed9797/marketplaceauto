/**
 * Auth bypass for local development only.
 *
 * Hard-blocks the bypass when:
 *   - NODE_ENV === "production"
 *   - VERCEL_ENV is "production" or "preview" (covers Preview deployments,
 *     which inherit NODE_ENV=production on Vercel but should still refuse a
 *     dev-mode shortcut in case the env var leaks into the Vercel project).
 *
 * Set DEV_AUTH_BYPASS_EMAIL in .env to auto-login as the user with that email
 * when running `next dev` locally.
 */
export function getDevBypassEmail(): string | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" || vercelEnv === "preview") {
    return null;
  }

  const email = process.env.DEV_AUTH_BYPASS_EMAIL?.trim();
  return email && email.length > 0 ? email : null;
}
