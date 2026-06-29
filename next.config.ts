import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  experimental: {
    optimizePackageImports: [
      "recharts",
      "lucide-react",
      "@radix-ui/react-slot",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

const sentryConfig =
  process.env.SENTRY_AUTH_TOKEN &&
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT
    ? {
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        silent: !process.env.CI,
      }
    : {
        silent: true,
      };

const shouldWrapSentry =
  Boolean(process.env.SENTRY_DSN) ||
  Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) ||
  Boolean(process.env.SENTRY_AUTH_TOKEN);

export default shouldWrapSentry
  ? withSentryConfig(nextConfig, sentryConfig)
  : nextConfig;
