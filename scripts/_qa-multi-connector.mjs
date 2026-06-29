#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/vitormiguelgoedertdaluz/Documents/W3ADS";
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
  }
}

test("1. sync route covers all 10 providers + defensive failure update", () => {
  const src = read("src/app/api/connectors/[id]/sync/route.ts");
  for (const p of [
    "META_ADS",
    "GOOGLE_ADS",
    "SHOPIFY",
    "NUVEMSHOP",
    "ISET",
    "TRAY",
    "WBUY",
    "MAGAZORD",
    "GOOGLE_SHEETS",
    "GA4",
  ]) {
    assert.ok(src.includes(p), `missing provider key ${p}`);
  }
  assert.ok(src.includes("syncMetaDailyMetrics"), "missing import syncMetaDailyMetrics");
  assert.ok(
    src.includes("syncGoogleAdsDailyMetrics"),
    "missing import syncGoogleAdsDailyMetrics",
  );
  assert.ok(
    src.includes("syncGoogleAnalyticsSessions"),
    "missing import syncGoogleAnalyticsSessions",
  );
  assert.ok(src.includes("lastSyncError"), "missing lastSyncError write");
  assert.ok(src.includes("lastSyncedAt"), "missing lastSyncedAt write");
  assert.ok(
    /status:\s*["']?ERROR["']?|ConnectorStatus\.ERROR/.test(src),
    "missing status=ERROR on failure",
  );
});

test("2. CredentialUnavailableError with codes", () => {
  const src = read("src/lib/connectors/credentials.ts");
  assert.ok(
    /class\s+CredentialUnavailableError/.test(src),
    "missing CredentialUnavailableError class",
  );
  assert.ok(/export[^]*CredentialUnavailableError/.test(src), "class not exported");
  assert.ok(src.includes("vault_unavailable"), "missing code 'vault_unavailable'");
  assert.ok(src.includes("no_credentials"), "missing code 'no_credentials'");
});

test("3. OAuth callbacks distinguish error types", () => {
  const callbacks = [
    "src/app/api/connectors/google-ads/callback/route.ts",
    "src/app/api/connectors/google-analytics/callback/route.ts",
    "src/app/api/connectors/meta/callback/route.ts",
    "src/app/api/connectors/nuvemshop/callback/route.ts",
    "src/app/api/connectors/shopify/callback/route.ts",
  ];
  const sentinels = [
    "oauth-vault-missing",
    "oauth-providerconfig-missing",
    "oauth-failed",
  ];
  for (const file of callbacks) {
    const src = read(file);
    const matched = sentinels.some((s) => src.includes(s));
    assert.ok(
      matched,
      `${file} missing any of [${sentinels.join(", ")}]`,
    );
  }
});

test("4. Dashboard fetchError in aggregator + page", () => {
  const agg = read("src/lib/metrics/aggregator.ts");
  assert.ok(agg.includes("fetchError"), "aggregator missing fetchError");
  assert.ok(agg.includes("schema_error"), "aggregator missing 'schema_error' literal");
  assert.ok(agg.includes("db_error"), "aggregator missing 'db_error' literal");

  const page = read("src/app/(app)/dashboard/page.tsx");
  assert.ok(
    /snapshot\.fetchError/.test(page),
    "dashboard page does not reference snapshot.fetchError",
  );
});

test("5. Middleware: auth (redirect) ordering before rateLimitMiddleware", () => {
  const src = read("src/middleware.ts");
  const rateLimitIdx = src.indexOf("rateLimitMiddleware(");
  const redirectIdx = src.indexOf("redirect(loginUrl)");
  assert.ok(rateLimitIdx >= 0, "rateLimitMiddleware( call not found");
  assert.ok(redirectIdx >= 0, "redirect(loginUrl) call not found");
  assert.ok(
    redirectIdx < rateLimitIdx,
    `redirect(loginUrl) at ${redirectIdx} should come BEFORE rateLimitMiddleware at ${rateLimitIdx}`,
  );
});

test("6. Inngest atomicity in select route", () => {
  const src = read("src/app/api/connectors/select/route.ts");
  assert.ok(
    src.includes("isInngestConfigured"),
    "missing isInngestConfigured import/usage",
  );
  const hasErrorMeta = src.includes("inngestSendError");
  const hasTryCatchAroundSend =
    /try\s*\{[^}]*inngest\.send\(/.test(src) ||
    /inngest\.send\([^)]*\)[^]*catch/.test(src);
  assert.ok(
    hasErrorMeta || hasTryCatchAroundSend,
    "no inngestSendError metadata field nor try/catch around inngest.send()",
  );
});

test("7. SyncNowButton hardening", () => {
  const src = read("src/components/connectors/sync-now-button.tsx");
  assert.ok(src.includes("lastSyncedAt"), "missing lastSyncedAt prop/usage");
  assert.ok(
    /response\.text\(/.test(src) || /\.text\(\)/.test(src),
    "response.text() not used",
  );
  assert.ok(/response\.status/.test(src), "response.status not referenced");
});

test("8. Manual route syncMode + inlineLastBackfillAt", () => {
  const src = read("src/app/api/connectors/manual/route.ts");
  assert.ok(src.includes("syncMode"), "missing syncMode in metadata");
  assert.ok(
    src.includes("inlineLastBackfillAt"),
    "missing inlineLastBackfillAt reference",
  );
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.err ? " — " + r.err : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
