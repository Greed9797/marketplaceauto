import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import type { NextAuthConfig } from "next-auth";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { logAudit } from "@/lib/audit/log";
import {
  getAuthSessionCookieName,
  getLaxCookieOptions,
} from "@/lib/auth/cookies";
import { prisma } from "@/lib/db/prisma";

// Sliding-window session idle policy.
// - TOUCH_INTERVAL_MS: how often we bump `lastSeenAt`. Throttled so we don't
//   write on every single request (Prisma session lookup happens per RSC).
// - IDLE_INVALIDATE_MS: how long a session can sit idle before being deleted
//   even though `expires` is still in the future.
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_IDLE_INVALIDATE_MS = 7 * 24 * 60 * 60 * 1000;

function withIdleEnforcement(base: Adapter): Adapter {
  const original = base.getSessionAndUser?.bind(base);
  if (!original) return base;
  return {
    ...base,
    async getSessionAndUser(sessionToken) {
      const result = await original(sessionToken);
      if (!result) return null;

      const sessionRow = result.session as typeof result.session & {
        lastSeenAt?: Date | null;
      };
      const lastSeenAtMs = sessionRow.lastSeenAt?.getTime();

      if (!lastSeenAtMs) {
        void prisma.session
          .update({
            where: { sessionToken },
            data: { lastSeenAt: new Date() },
          })
          .catch(() => {});
        return result;
      }

      const idleMs = Date.now() - lastSeenAtMs;

      if (idleMs > SESSION_IDLE_INVALIDATE_MS) {
        await prisma.session
          .delete({ where: { sessionToken } })
          .catch(() => {});
        return null;
      }

      if (idleMs > SESSION_TOUCH_INTERVAL_MS) {
        // Fire-and-forget — never block auth resolution on a touch write.
        void prisma.session
          .update({
            where: { sessionToken },
            data: { lastSeenAt: new Date() },
          })
          .catch(() => {});
      }

      return result;
    },
  };
}

const providers: NextAuthConfig["providers"] = [];

if (
  process.env.GOOGLE_OAUTH_CLIENT_ID &&
  process.env.GOOGLE_OAUTH_CLIENT_SECRET
) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      authorization: {
        params: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  );
}

async function safeLogAudit(input: Parameters<typeof logAudit>[0]) {
  try {
    await logAudit(input);
  } catch {
    // Audit failures must not block auth callbacks.
  }
}

function resolveAuthSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (secret && secret.length > 0) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET (ou NEXTAUTH_SECRET) é obrigatório em produção. Gere com `openssl rand -base64 32` e configure no provedor de hosting.",
    );
  }

  return "adstart-w3-local-development-secret";
}

const authSecret = resolveAuthSecret();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: withIdleEnforcement(PrismaAdapter(prisma)),
  secret: authSecret,
  session: {
    strategy: "database",
  },
  cookies: {
    sessionToken: {
      // `lax`, NOT `strict`: a strict session cookie is dropped on the
      // top-level cross-site GET when an OAuth provider (Google) redirects back
      // to our connector callback, so getCurrentUserContext() sees no session
      // and bounces to /login — an infinite login loop that blocks every
      // connector sync. `lax` survives that return while still blocking
      // cross-site POST/CSRF, and matches the Auth.js default.
      name: getAuthSessionCookieName(),
      options: getLaxCookieOptions(),
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers,
  trustHost:
    process.env.AUTH_TRUST_HOST === "true" ||
    process.env.NODE_ENV !== "production",
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }

      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (user.id) {
        await safeLogAudit({
          action: "auth.login",
          userId: user.id,
          resourceType: "user",
          resourceId: user.id,
        });
      }
    },
    async signOut(message) {
      const sessionToken =
        "session" in message
          ? message.session?.sessionToken
          : message.token?.jti;

      if (sessionToken) {
        // Store only a short fingerprint of the session token in the audit log
        // — full tokens MUST NOT live alongside lower-secured audit metadata.
        const { createHash } = await import("node:crypto");
        const fingerprint = createHash("sha256")
          .update(sessionToken)
          .digest("hex")
          .slice(0, 16);
        await safeLogAudit({
          action: "auth.logout",
          metadata: { sessionFingerprint: fingerprint },
        });
      }
    },
  },
});
