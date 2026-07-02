# NuvemShop Revenue Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the adstart-w3 dashboard's NuvemShop revenue match the store's own report (bucket revenue by order **creation date**, ingest late-paid orders via `updated_at` incremental sync) so Cotton Chic June 2026 reconciles to R$ 43.922,29.

**Architecture:** Add a nullable `orderCreatedAt` column to `EcommerceOrder`, capture `order.created_at` in the NuvemShop normalizer, and switch the revenue aggregation to bucket/filter by `orderCreatedAt` (falling back to `placedAt` while null). Add an `updated_at`/`status=any` fetch path to the NuvemShop client and drive the recurring sync incrementally by `updated_at` so pending→paid transitions are captured. Ship in phases: migration → code (backward-compatible fallback) → one-time re-backfill → verify.

**Tech Stack:** Next.js 15, Prisma 5.22 (`@prisma/client`), PostgreSQL/Supabase, TypeScript (strict), Vitest 4, decimal.js, Sentry. Package name: `adstart-w3`.

## Global Constraints

- **Money is correct — never change amounts.** `orderTotal` already equals `total_paid`. This plan changes only the **date** a paid order is attributed to, never its value.
- **Backward-compatible, phased.** `orderCreatedAt` is **nullable**; every new function parameter is **optional with a backward-compatible default** (`dateField` defaults to `"created_at"`, `paidOnly` defaults to `true`). Aggregation **falls back to `placedAt`** whenever `orderCreatedAt` is null. Fallback is removed only after 100% backfill (out of scope here).
- **Prisma schema is single-schema; production Postgres schema is `w3ads`** (selected via `?schema=w3ads` in `DATABASE_URL`/`DIRECT_URL`). The local `.env` points at the **empty** `w3marketplace` schema — for any local DB work repoint it to `w3ads`, but note that **unit tests never touch the DB** (they import pure functions; `PrismaClient` instantiates without connecting).
- **Migrations are hand-authored raw SQL** under `prisma/migrations/<14-digit-timestamp>_<name>/migration.sql` (idempotent, `IF NOT EXISTS`, schema-qualified `"w3ads"."EcommerceOrder"`). **Do NOT run `prisma migrate dev`** — it would diff the schema and generate a competing/unqualified migration. Apply with `npx prisma migrate deploy` (also run automatically by `npm run build`). Regenerate the client with `npx prisma generate`.
- **Timezone:** store is BRT (UTC-3, no DST). The aggregator already applies a `+3h` shift (`brtBound`/`brtDateKey`) — reuse it; do not introduce a second shift.
- **Test command:** `npx vitest run <file>`. **Typecheck:** `npm run typecheck`. **Full suite gate:** `npx vitest run`.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`).

---

## File Structure

**Modified:**
- `prisma/schema.prisma` — add `orderCreatedAt DateTime?` + index to `EcommerceOrder`.
- `src/lib/connectors/shopify/client.ts` — add `orderCreatedAt?: string | null` to the shared normalized `ShopifyOrder` type (used by every connector).
- `src/lib/connectors/nuvemshop/client.ts` — capture `created_at` in `normalizeNuvemshopOrder`; parametrize `ordersUrl`/`listOrders` for `updated_at` + `status=any`.
- `src/lib/connectors/ecommerce-sync.ts` — write `orderCreatedAt`; extract `partitionOrdersForPersist`; surface `skippedInvalidDate`; bucket the DB recompute + daily-summary by `orderCreatedAt` with fallback; thread `dateField`/`paidOnly` into the NuvemShop fetch.
- `src/lib/connectors/sync-range.ts` — add `computeIncrementalRange` + optional `dateField`/`paidOnly` on `SyncRange`.
- `src/lib/connectors/sync-helpers.ts` — widen `SyncHelperInput.range` with optional `dateField`/`paidOnly`.
- `src/lib/workspace/sync-orchestrator.ts` — foreground NuvemShop accounts sync incrementally by `updated_at`; select `lastSyncedAt`.
- `src/lib/metrics/aggregator.ts` — add `orderCreatedAt?` to `DashboardOrderRow`; bucket/filter revenue by `orderRevenueDate()`; broaden the DB fetch window.

**Created:**
- `prisma/migrations/20260701160000_ecommerce_order_created_at/migration.sql` — column + index.
- `scripts/_qa-nuvemshop-reconcile.ts` — sum paid, non-cancelled orders by `orderCreatedAt` (BRT) for a month (acceptance check).
- `scripts/_qa-nuvemshop-rebackfill.ts` — one-time re-backfill by `created_at`/`status=any` to populate `orderCreatedAt` and ingest missing late-paid orders.
- `tests/unit/ecommerce-order-mapping.test.ts` — `mapEcommerceOrderToRecord` + `partitionOrdersForPersist`.
- `tests/unit/nuvemshop-reconciliation.test.ts` — end-to-end created-date reconciliation.

**Extended (tests):**
- `tests/unit/nuvemshop-oauth.test.ts` — `orderCreatedAt` capture + `updated_at`/`status=any` URL.
- `tests/unit/dashboard-aggregator.test.ts` — created-date bucketing / fallback / cancelled / BRT boundary.
- `tests/unit/sync-range.test.ts` — `computeIncrementalRange`.
- `tests/unit/sync-orchestrator.test.ts` — `lastSyncedAt` selected; NuvemShop foreground uses `updated_at` range.

---

## Task 1: Migration — add `orderCreatedAt` column + index

**Files:**
- Modify: `prisma/schema.prisma:317-342` (`model EcommerceOrder`)
- Create: `prisma/migrations/20260701160000_ecommerce_order_created_at/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model field `EcommerceOrder.orderCreatedAt: Date | null` and generated client types (`orderCreatedAt` usable in `select`, `where`, `create`, `update`). Index `EcommerceOrder_workspaceId_platform_orderCreatedAt_idx`.

- [ ] **Step 1: Add the field + index to the Prisma schema**

In `prisma/schema.prisma`, inside `model EcommerceOrder`, add the `orderCreatedAt` field after `placedAt` and the index after the existing `@@index` lines. Final block:

```prisma
model EcommerceOrder {
  id                 String               @id @default(cuid())
  workspaceId        String
  workspace          Workspace            @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  connectorAccountId String
  connectorAccount   ConnectorAccount     @relation(fields: [connectorAccountId], references: [id], onDelete: Cascade)
  externalOrderId    String
  platform           ConnectorProvider
  orderNumber        String?
  customerEmail      String?
  orderTotal         Decimal              @db.Decimal(14, 2)
  orderCurrency      String               @default("BRL")
  itemsCount         Int
  status             String
  shippingState      String?
  utmSource          String?
  utmMedium          String?
  utmCampaign        String?
  placedAt           DateTime
  // Order CREATION timestamp from the source platform (NuvemShop order.created_at).
  // Revenue is bucketed by this date to match the store's own revenue report.
  // Nullable + backward-compatible: legacy rows stay NULL until re-backfilled and
  // the aggregator falls back to placedAt while NULL.
  orderCreatedAt     DateTime?
  createdAt          DateTime             @default(now())
  items              EcommerceOrderItem[]

  @@unique([connectorAccountId, externalOrderId])
  @@index([workspaceId, placedAt])
  @@index([workspaceId, platform, placedAt])
  @@index([workspaceId, platform, orderCreatedAt])
}
```

- [ ] **Step 2: Validate the schema (should still parse)**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Create the raw-SQL migration**

Create `prisma/migrations/20260701160000_ecommerce_order_created_at/migration.sql` with exactly:

```sql
-- NuvemShop revenue reconciliation: bucket revenue by the order's CREATION date
-- (source platform order.created_at), matching the store's own revenue report,
-- instead of paid_at (placedAt). Nullable + backward-compatible: existing rows
-- stay NULL until re-backfilled; the aggregator falls back to placedAt while NULL.
ALTER TABLE "w3ads"."EcommerceOrder"
  ADD COLUMN IF NOT EXISTS "orderCreatedAt" TIMESTAMP(3);

-- Speeds up the dashboard revenue query that now filters by
-- workspaceId + platform + orderCreatedAt window.
CREATE INDEX IF NOT EXISTS "EcommerceOrder_workspaceId_platform_orderCreatedAt_idx"
  ON "w3ads"."EcommerceOrder" ("workspaceId", "platform", "orderCreatedAt");
```

> If `prisma/migrations/migration_lock.toml` does not exist, create it with:
> ```toml
> provider = "postgresql"
> ```

- [ ] **Step 4: Regenerate the client and typecheck (this is the RED→GREEN for a migration)**

Run: `npx prisma generate && npm run typecheck`
Expected: `prisma generate` succeeds; `tsc --noEmit` exits 0 (no errors). The generated client now types `orderCreatedAt`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260701160000_ecommerce_order_created_at
git commit -m "feat: add nullable EcommerceOrder.orderCreatedAt column + index"
```

> Production apply happens via `npx prisma migrate deploy` (also in `npm run build`). Deploy this migration **before** the code changes (rollout phase 1).

---

## Task 2: NuvemShop normalizer captures `created_at`

**Files:**
- Modify: `src/lib/connectors/shopify/client.ts` (exported `ShopifyOrder` type)
- Modify: `src/lib/connectors/nuvemshop/client.ts:157-201` (`normalizeNuvemshopOrder`)
- Test: `tests/unit/nuvemshop-oauth.test.ts`

**Interfaces:**
- Consumes: `pickValidIsoDate(...candidates): string` (existing, returns `""` for none valid).
- Produces: `ShopifyOrder.orderCreatedAt?: string | null` (ISO string when the platform sent a valid `created_at`, else `null`). This is the shared normalized order type consumed by `mapEcommerceOrderToRecord` (Task 4) and every connector.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/nuvemshop-oauth.test.ts` inside the `describe("Nuvemshop OAuth", ...)` block:

```ts
  it("captures order created_at as orderCreatedAt, independent of placedAt", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json([
        {
          id: 1,
          total: "100.00",
          total_paid: "100.00",
          payment_status: "paid",
          // Created in June, paid in July — the exact reconciliation case.
          created_at: "2026-06-15T10:00:00Z",
          paid_at: "2026-07-02T09:00:00Z",
        },
      ]),
    );
    const client = new NuvemshopClient({
      config,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.listOrders({
      storeId: "2093261",
      accessToken: "store-token",
      since: "2026-06-01",
      until: "2026-06-30",
    });

    expect(result.orders[0].orderCreatedAt).toBe("2026-06-15T10:00:00.000Z");
    // placedAt still follows the paid_at → completed_at → created_at chain.
    expect(result.orders[0].placedAt).toBe("2026-07-02T09:00:00.000Z");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/nuvemshop-oauth.test.ts`
Expected: FAIL — `result.orders[0].orderCreatedAt` is `undefined` (received `undefined`, expected `"2026-06-15T10:00:00.000Z"`).

- [ ] **Step 3: Add `orderCreatedAt` to the shared `ShopifyOrder` type**

In `src/lib/connectors/shopify/client.ts`, add `orderCreatedAt` to the exported `ShopifyOrder` type (after `placedAt`):

```ts
export type ShopifyOrder = {
  externalOrderId: string;
  orderNumber: string | null;
  orderTotal: string;
  orderCurrency: string;
  customerEmail: string | null;
  itemsCount: number;
  items?: ShopifyOrderItem[];
  status: string;
  shippingState?: string | null;
  placedAt: string;
  // Source platform order.created_at (ISO), used to bucket revenue by creation
  // date. Optional/nullable: connectors that don't provide it leave it undefined
  // and the aggregator falls back to placedAt.
  orderCreatedAt?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};
```

- [ ] **Step 4: Populate it in the NuvemShop normalizer**

In `src/lib/connectors/nuvemshop/client.ts`, edit `normalizeNuvemshopOrder` to add `orderCreatedAt`. Compute the ISO once and return `null` when `created_at` is empty/invalid. Add the field to the returned object right after `placedAt`:

```ts
function normalizeNuvemshopOrder(order: NuvemshopOrderPayload): ShopifyOrder {
  const externalOrderId = asString(order.id);
  if (!externalOrderId) {
    throw new Error("Nuvemshop order is missing id");
  }

  // Creation timestamp for revenue bucketing (NuvemShop reports revenue by
  // created_at). pickValidIsoDate returns "" when absent/invalid → store null.
  const orderCreatedAtIso = pickValidIsoDate(order.created_at);

  return {
    externalOrderId,
    orderNumber: asString(order.number),
    orderTotal: asString(order.total_paid ?? order.total) ?? "0",
    orderCurrency: order.currency ?? "BRL",
    customerEmail: order.contact_email ?? order.email ?? null,
    itemsCount:
      order.products?.reduce((sum, item) => {
        const quantity = Number(item.quantity ?? 1);

        return sum + (Number.isFinite(quantity) ? quantity : 1);
      }, 0) ?? 0,
    items:
      order.products?.map((item, index) => {
        const quantity = Number(item.quantity ?? 1);

        return {
          productName: item.name ?? item.product_name ?? `Produto ${index + 1}`,
          sku: item.sku ?? null,
          quantity: Number.isFinite(quantity) ? quantity : 1,
          total: asString(item.total ?? item.price),
        };
      }) ?? [],
    status: order.payment_status ?? order.status ?? "UNKNOWN",
    shippingState:
      order.shipping_address?.province_code ??
      order.shipping_address?.state ??
      order.shipping_address?.province ??
      null,
    placedAt: pickValidIsoDate(
      order.paid_at,
      order.completed_at,
      order.created_at,
    ),
    orderCreatedAt: orderCreatedAtIso || null,
    utmSource: order.utm_source ?? null,
    utmMedium: order.utm_medium ?? null,
    utmCampaign: order.utm_campaign ?? null,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/nuvemshop-oauth.test.ts`
Expected: PASS (all cases, including the existing pagination test).

- [ ] **Step 6: Commit**

```bash
git add src/lib/connectors/shopify/client.ts src/lib/connectors/nuvemshop/client.ts tests/unit/nuvemshop-oauth.test.ts
git commit -m "feat: capture NuvemShop order created_at as orderCreatedAt"
```

---

## Task 3: NuvemShop client supports `updated_at` filter + `status=any`

**Files:**
- Modify: `src/lib/connectors/nuvemshop/client.ts:347-471` (`ordersUrl` private + `listOrders` public)
- Test: `tests/unit/nuvemshop-oauth.test.ts`

**Interfaces:**
- Consumes: `ShopifyOrder` (from Task 2).
- Produces: `NuvemshopClient.listOrders(input)` gains optional `dateField?: "created_at" | "updated_at"` (default `"created_at"`) and `paidOnly?: boolean` (default `true`). When `dateField: "updated_at"` the URL uses `updated_at_min`/`updated_at_max`; when `paidOnly: false` the URL omits `payment_status=paid` (pulls all payment statuses via `status=any`).

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/nuvemshop-oauth.test.ts`:

```ts
  it("filters by updated_at with status=any when incremental", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json([]));
    const client = new NuvemshopClient({
      config,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.listOrders({
      storeId: "2093261",
      accessToken: "store-token",
      since: "2026-06-01",
      until: "2026-06-30",
      dateField: "updated_at",
      paidOnly: false,
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("updated_at_min")).toBe("2026-06-01T00:00:00Z");
    expect(url.searchParams.get("updated_at_max")).toBe("2026-06-30T23:59:59Z");
    expect(url.searchParams.get("status")).toBe("any");
    expect(url.searchParams.has("payment_status")).toBe(false);
    expect(url.searchParams.has("created_at_min")).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/nuvemshop-oauth.test.ts -t "updated_at"`
Expected: FAIL — `updated_at_min` is `null` (client always emits `created_at_min` and `payment_status=paid`).

- [ ] **Step 3: Parametrize `ordersUrl`**

In `src/lib/connectors/nuvemshop/client.ts`, replace the `ordersUrl` method with:

```ts
  private ordersUrl(input: {
    storeId: string;
    since: string;
    until: string;
    page: number;
    // "created_at" (default) for historical backfill; "updated_at" for the
    // incremental recurring sync so late-paid / refunded transitions surface.
    dateField?: "created_at" | "updated_at";
    // true (default) filters payment_status=paid at the source; false pulls all
    // payment statuses (status=any) so pending→paid and paid→refunded are seen
    // and the paid/non-cancelled decision moves to the aggregation layer.
    paidOnly?: boolean;
  }) {
    const dateField = input.dateField ?? "created_at";
    const paidOnly = input.paidOnly ?? true;
    const url = new URL(`${this.config.apiBaseUrl}/${input.storeId}/orders`);
    // `since`/`until` may arrive as a full ISO instant (e.g.
    // "2026-06-01T00:00:00.000Z") from the sync range or as a plain
    // "YYYY-MM-DD". Slice the date portion before re-appending the day bounds
    // so we never emit a double-suffixed string like "...000ZT00:00:00Z",
    // which Nuvemshop rejects with HTTP 422 Unprocessable Entity.
    url.searchParams.set(`${dateField}_min`, `${input.since.slice(0, 10)}T00:00:00Z`);
    url.searchParams.set(`${dateField}_max`, `${input.until.slice(0, 10)}T23:59:59Z`);
    // Fulfillment-agnostic (open/closed). payment_status is set only in paidOnly
    // mode; incremental sync pulls every payment status (status=any) and lets the
    // metric rollup (isApprovedOrderStatus) decide revenue one layer later.
    url.searchParams.set("status", "any");
    if (paidOnly) {
      url.searchParams.set("payment_status", "paid");
    }
    url.searchParams.set("page", String(input.page));
    url.searchParams.set("per_page", "200");

    return url;
  }
```

- [ ] **Step 4: Thread the flags through `listOrders`**

In the same file, add `dateField` and `paidOnly` to the `listOrders` input type and pass them to `ordersUrl`. Add these two properties to the `listOrders` input object type (alongside `deadlineMs`, `startPage`, `onPage`):

```ts
    /** Filter by "created_at" (default, backfill) or "updated_at" (incremental). */
    dateField?: "created_at" | "updated_at";
    /** true (default) = payment_status=paid; false = all payment statuses. */
    paidOnly?: boolean;
```

Then update the `this.ordersUrl({ ... })` call inside the pagination loop to forward them:

```ts
      const url = this.ordersUrl({
        storeId: input.storeId,
        since: input.since,
        until: input.until,
        page,
        dateField: input.dateField,
        paidOnly: input.paidOnly,
      });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/nuvemshop-oauth.test.ts`
Expected: PASS — the new `updated_at` test passes and the existing test (`payment_status === "paid"` by default) still passes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/connectors/nuvemshop/client.ts tests/unit/nuvemshop-oauth.test.ts
git commit -m "feat: support updated_at + status=any fetch in NuvemShop client"
```

---

## Task 4: Persist `orderCreatedAt` + surface `skippedInvalidDate`

**Files:**
- Modify: `src/lib/connectors/ecommerce-sync.ts:133-160` (`mapEcommerceOrderToRecord`), `:168-171` (add `parseOptionalDate`), `:200-291` (`persistOrdersOnly` → extract `partitionOrdersForPersist`), `:327-335` (`persistEcommerceOrders`), and the import block (`:1-56`)
- Test: `tests/unit/ecommerce-order-mapping.test.ts` (new)

**Interfaces:**
- Consumes: `ShopifyOrder.orderCreatedAt` (Task 2); `EcommerceOrder.orderCreatedAt` column (Task 1).
- Produces:
  - `mapEcommerceOrderToRecord(input)` return object gains `orderCreatedAt: Date | null`.
  - `export function partitionOrdersForPersist(input: { workspaceId: string; connectorAccountId: string; provider: ConnectorProvider; orders: ShopifyOrder[] }): { valid: Array<{ order: ShopifyOrder; payload: NonNullable<ReturnType<typeof mapEcommerceOrderToRecord>> }>; skippedInvalidDate: number }`.
  - `persistOrdersOnly(input)` now returns `Promise<{ ingestedOrders: ShopifyOrder[]; skippedInvalidDate: number }>` (was `Promise<ShopifyOrder[]>`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ecommerce-order-mapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConnectorProvider } from "@prisma/client";

import {
  mapEcommerceOrderToRecord,
  partitionOrdersForPersist,
} from "@/lib/connectors/ecommerce-sync";
import type { ShopifyOrder } from "@/lib/connectors/shopify/client";

const base: ShopifyOrder = {
  externalOrderId: "1",
  orderNumber: null,
  orderTotal: "10.00",
  orderCurrency: "BRL",
  customerEmail: null,
  itemsCount: 0,
  status: "paid",
  placedAt: "2026-07-02T09:00:00Z",
};

describe("mapEcommerceOrderToRecord", () => {
  it("maps orderCreatedAt to a Date and keeps null when absent", () => {
    const withCreated = mapEcommerceOrderToRecord({
      workspaceId: "w",
      connectorAccountId: "c",
      provider: ConnectorProvider.NUVEMSHOP,
      order: { ...base, orderCreatedAt: "2026-06-15T10:00:00Z" },
    });
    expect(withCreated?.orderCreatedAt?.toISOString()).toBe(
      "2026-06-15T10:00:00.000Z",
    );
    expect(withCreated?.placedAt.toISOString()).toBe("2026-07-02T09:00:00.000Z");

    const withoutCreated = mapEcommerceOrderToRecord({
      workspaceId: "w",
      connectorAccountId: "c",
      provider: ConnectorProvider.NUVEMSHOP,
      order: base,
    });
    expect(withoutCreated?.orderCreatedAt).toBeNull();
  });
});

describe("partitionOrdersForPersist", () => {
  it("keeps valid-date orders and counts invalid-placedAt skips", () => {
    const { valid, skippedInvalidDate } = partitionOrdersForPersist({
      workspaceId: "w",
      connectorAccountId: "c",
      provider: ConnectorProvider.NUVEMSHOP,
      orders: [base, { ...base, externalOrderId: "2", placedAt: "" }],
    });
    expect(valid).toHaveLength(1);
    expect(valid[0].order.externalOrderId).toBe("1");
    expect(skippedInvalidDate).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ecommerce-order-mapping.test.ts`
Expected: FAIL — `partitionOrdersForPersist` is not exported (import error / `TypeError: partitionOrdersForPersist is not a function`), and `orderCreatedAt` is not on the record.

- [ ] **Step 3: Add the Sentry import**

In `src/lib/connectors/ecommerce-sync.ts`, add to the import block (after the `import Decimal from "decimal.js";` line at the top):

```ts
import * as Sentry from "@sentry/nextjs";
```

- [ ] **Step 4: Add `parseOptionalDate` and write `orderCreatedAt` in the record**

In `src/lib/connectors/ecommerce-sync.ts`, add a helper next to `parsePlacedAt` (after the `parsePlacedAt` function, ~line 171):

```ts
/**
 * Parses an optional ISO timestamp to Date, returning null for
 * absent/empty/invalid input. Used for orderCreatedAt, which is nullable
 * (connectors that don't provide a creation date leave it null).
 */
function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts) : null;
}
```

Then add `orderCreatedAt` to the object returned by `mapEcommerceOrderToRecord` (after `placedAt`):

```ts
export function mapEcommerceOrderToRecord(input: {
  workspaceId: string;
  connectorAccountId: string;
  provider: ConnectorProvider;
  order: ShopifyOrder;
}) {
  const placedAt = parsePlacedAt(input.order.placedAt);
  if (placedAt === null) {
    return null;
  }
  return {
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    externalOrderId: input.order.externalOrderId,
    platform: input.provider,
    orderNumber: input.order.orderNumber,
    customerEmail: input.order.customerEmail,
    orderTotal: input.order.orderTotal,
    orderCurrency: input.order.orderCurrency,
    itemsCount: input.order.itemsCount,
    status: input.order.status,
    shippingState: input.order.shippingState,
    utmSource: input.order.utmSource,
    utmMedium: input.order.utmMedium,
    utmCampaign: input.order.utmCampaign,
    placedAt,
    orderCreatedAt: parseOptionalDate(input.order.orderCreatedAt),
  };
}
```

- [ ] **Step 5: Extract `partitionOrdersForPersist` and update `persistOrdersOnly`**

In `src/lib/connectors/ecommerce-sync.ts`, add the exported partition helper immediately before `persistOrdersOnly`:

```ts
/**
 * Splits a batch into orders with a valid placedAt (kept, with their upsert
 * payload) and a count of those skipped for an invalid/empty date. Pure and
 * exported so the skip logic is unit-testable without a DB.
 */
export function partitionOrdersForPersist(input: {
  workspaceId: string;
  connectorAccountId: string;
  provider: ConnectorProvider;
  orders: ShopifyOrder[];
}): {
  valid: Array<{
    order: ShopifyOrder;
    payload: NonNullable<ReturnType<typeof mapEcommerceOrderToRecord>>;
  }>;
  skippedInvalidDate: number;
} {
  const valid: Array<{
    order: ShopifyOrder;
    payload: NonNullable<ReturnType<typeof mapEcommerceOrderToRecord>>;
  }> = [];
  let skippedInvalidDate = 0;

  for (const order of input.orders) {
    const payload = mapEcommerceOrderToRecord({
      workspaceId: input.workspaceId,
      connectorAccountId: input.connectorAccountId,
      provider: input.provider,
      order,
    });
    if (payload === null) {
      skippedInvalidDate += 1;
      continue;
    }
    valid.push({ order, payload });
  }

  return { valid, skippedInvalidDate };
}
```

Then replace the body of `persistOrdersOnly` so it uses the helper, returns the count, and alerts via Sentry. Change its signature return type and the loop preamble (the per-batch upsert loop is unchanged — keep the existing `for (const batch of chunks(validOrders, ORDER_PERSIST_CONCURRENCY)) { ... }` body verbatim). The new top and bottom:

```ts
async function persistOrdersOnly(input: {
  workspaceId: string;
  connectorAccountId: string;
  provider: ConnectorProvider;
  orders: ShopifyOrder[];
}): Promise<{ ingestedOrders: ShopifyOrder[]; skippedInvalidDate: number }> {
  const { valid: validOrders, skippedInvalidDate } =
    partitionOrdersForPersist(input);
  const ingestedOrders: ShopifyOrder[] = [];

  for (const batch of chunks(validOrders, ORDER_PERSIST_CONCURRENCY)) {
    await Promise.all(
      batch.map(async ({ order, payload }) => {
        const hasItems = (order.items?.length ?? 0) > 0;

        // Fast path: orders with no line items (e.g. iSET order list) just
        // upsert the order — no transaction, no per-order item deleteMany.
        // This removes ~2 extra queries per order, which is what made heavy
        // backfills (1k+ orders/month) blow past the function timeout.
        if (!hasItems) {
          await prisma.ecommerceOrder.upsert({
            where: {
              connectorAccountId_externalOrderId: {
                connectorAccountId: input.connectorAccountId,
                externalOrderId: order.externalOrderId,
              },
            },
            update: payload,
            create: payload,
          });
          ingestedOrders.push(order);
          return;
        }

        await prisma.$transaction(async (tx) => {
          const savedOrder = await tx.ecommerceOrder.upsert({
            where: {
              connectorAccountId_externalOrderId: {
                connectorAccountId: input.connectorAccountId,
                externalOrderId: order.externalOrderId,
              },
            },
            update: payload,
            create: payload,
          });
          const itemPayloads = mapEcommerceOrderItemsToRecords({
            workspaceId: input.workspaceId,
            connectorAccountId: input.connectorAccountId,
            ecommerceOrderId: savedOrder.id,
            order,
            placedAt: payload.placedAt,
          });

          await tx.ecommerceOrderItem.deleteMany({
            where: {
              connectorAccountId: input.connectorAccountId,
              externalOrderId: order.externalOrderId,
            },
          });

          if (itemPayloads.length) {
            await tx.ecommerceOrderItem.createMany({
              data: itemPayloads,
            });
          }
        });
        ingestedOrders.push(order);
      }),
    );
  }

  if (skippedInvalidDate > 0) {
    const message = `[ecommerce-sync] skipped ${skippedInvalidDate} orders with invalid placedAt (provider=${input.provider} workspaceId=${input.workspaceId})`;
    console.warn(message);
    // Surface as a Sentry metric instead of a silent console.warn so recurring
    // date-skip regressions are observable.
    Sentry.captureMessage(message, "warning");
  }

  return { ingestedOrders, skippedInvalidDate };
}
```

- [ ] **Step 6: Update `persistEcommerceOrders` to destructure the new return**

In `src/lib/connectors/ecommerce-sync.ts`, update `persistEcommerceOrders`:

```ts
async function persistEcommerceOrders(input: {
  workspaceId: string;
  connectorAccountId: string;
  provider: ConnectorProvider;
  orders: ShopifyOrder[];
}) {
  const { ingestedOrders } = await persistOrdersOnly(input);
  await writeDailyMetricsFromOrders({ ...input, orders: ingestedOrders });
}
```

> The streaming `onPage` callers (NuvemShop/Mercado Livre/Shopee/iSET blocks) call `await persistOrdersOnly({ ... })` and ignore the return value — no change needed there.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/unit/ecommerce-order-mapping.test.ts && npm run typecheck`
Expected: PASS (both tests) and typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/connectors/ecommerce-sync.ts tests/unit/ecommerce-order-mapping.test.ts
git commit -m "feat: persist orderCreatedAt and surface skippedInvalidDate metric"
```

---

## Task 5: Aggregate revenue by `orderCreatedAt` (with `placedAt` fallback)

**Files:**
- Modify: `src/lib/metrics/aggregator.ts:19-30` (`DashboardOrderRow`), add `orderRevenueDate` helper, `:506-528` (order filters), `:641-653` and `:688-699` (daily buckets), `:1247-1306` (`findDashboardOrders`)
- Modify: `src/lib/connectors/ecommerce-sync.ts:96-131` (`mapEcommerceOrdersToDailyMetricSummaries`), `:346-388` (`recomputeEcommerceDailyMetricsFromDb`)
- Test: `tests/unit/dashboard-aggregator.test.ts`

**Interfaces:**
- Consumes: `DashboardOrderRow`, `ShopifyOrder.orderCreatedAt`, `EcommerceOrder.orderCreatedAt`.
- Produces:
  - `DashboardOrderRow.orderCreatedAt?: Date | null` (optional).
  - `buildDashboardSnapshot` buckets/filters order **revenue** by `orderCreatedAt ?? placedAt`.
  - `mapEcommerceOrdersToDailyMetricSummaries` buckets by `orderCreatedAt ?? placedAt`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/dashboard-aggregator.test.ts` inside `describe("dashboard aggregator", ...)`:

```ts
  it("buckets NuvemShop revenue by orderCreatedAt with placedAt fallback", () => {
    const period = getDashboardPeriod(
      { period: "custom", from: "2026-06-01", to: "2026-06-30" },
      new Date("2026-07-15T12:00:00.000Z"),
    );
    const snapshot = buildDashboardSnapshot({
      period,
      commerceProviders: [ConnectorProvider.NUVEMSHOP],
      orders: [
        {
          // Created in June, PAID in July → must count in June.
          connectorAccountId: "nuvem-1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "100.00",
          status: "paid",
          orderCreatedAt: new Date("2026-06-15T12:00:00.000Z"),
          placedAt: new Date("2026-07-10T12:00:00.000Z"),
        },
        {
          // Legacy row (orderCreatedAt null) → falls back to placedAt in June.
          connectorAccountId: "nuvem-1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "40.00",
          status: "paid",
          placedAt: new Date("2026-06-20T12:00:00.000Z"),
        },
        {
          // Created in June but cancelled → revenue zero.
          connectorAccountId: "nuvem-1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "999.00",
          status: "cancelado",
          orderCreatedAt: new Date("2026-06-05T12:00:00.000Z"),
          placedAt: new Date("2026-06-05T12:00:00.000Z"),
        },
        {
          // BRT boundary: 2026-06-30 23:30 BRT = 2026-07-01T02:30Z → June.
          connectorAccountId: "nuvem-1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "10.00",
          status: "paid",
          orderCreatedAt: new Date("2026-07-01T02:30:00.000Z"),
          placedAt: new Date("2026-07-01T02:30:00.000Z"),
        },
      ],
      metrics: [],
    });

    // 100 (June-created, July-paid) + 40 (fallback) + 10 (BRT boundary) = 150.
    expect(snapshot.kpis.revenue.value).toBe(150);
    expect(snapshot.kpis.approvedOrders.value).toBe(3);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-aggregator.test.ts -t "orderCreatedAt"`
Expected: FAIL — revenue is `50` (only the two orders whose `placedAt` lands in June: the R$40 fallback + the R$10 boundary; the R$100 June-created/July-paid order is bucketed by `placedAt` in July and excluded). Also a TS error would appear on `orderCreatedAt` until Step 3.

- [ ] **Step 3: Add `orderCreatedAt` to `DashboardOrderRow` and the `orderRevenueDate` helper**

In `src/lib/metrics/aggregator.ts`, add the field to `DashboardOrderRow` (after `placedAt`):

```ts
export type DashboardOrderRow = {
  connectorAccountId: string;
  platform: ConnectorProvider;
  orderTotal: NumericLike;
  itemsCount?: number | null;
  status?: string | null;
  shippingState?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  placedAt: Date;
  // Order creation date; revenue buckets by this when present (falls back to
  // placedAt for legacy rows not yet re-backfilled).
  orderCreatedAt?: Date | null;
};
```

Then add the helper next to `brtBound` (after the `brtBound` function, ~line 236):

```ts
// Revenue is attributed to the order's CREATION date (matching the store's own
// revenue report), falling back to placedAt (paid_at) for legacy rows whose
// orderCreatedAt has not been backfilled yet.
function orderRevenueDate(order: DashboardOrderRow): Date {
  return order.orderCreatedAt ?? order.placedAt;
}
```

- [ ] **Step 4: Bucket/filter orders by `orderRevenueDate`**

In `src/lib/metrics/aggregator.ts`, in `buildDashboardSnapshot`, replace `order.placedAt` with `orderRevenueDate(order)` in the four revenue-relevant places:

Current-period filter (~line 521):

```ts
  const currentOrders = filteredOrders.filter((order) =>
    isWithinBrt(orderRevenueDate(order), period.from, period.to),
  );
```

Previous-period filter (~line 524):

```ts
  const previousOrders = input.orders.filter(
    (order) =>
      commerceProviders.includes(order.platform) &&
      isWithinBrt(
        orderRevenueDate(order),
        period.comparison.from,
        period.comparison.to,
      ),
  );
```

Current daily bucket (~line 642):

```ts
  for (const order of currentOrders) {
    const item = daily.get(brtDateKey(orderRevenueDate(order)));
    if (item) {
```

Previous daily bucket (~line 689):

```ts
  for (const order of previousOrders) {
    const currentKey = alignedByPreviousDate.get(
      brtDateKey(orderRevenueDate(order)),
    );
    const item = currentKey ? daily.get(currentKey) : null;
    if (item) {
```

> Do **not** change `filteredOrderItems` (line-item bucketing stays on `item.placedAt`) — items feed the products/categories widgets, not the headline revenue KPI, and carry no creation date.

- [ ] **Step 5: Broaden the DB fetch window in `findDashboardOrders`**

In `src/lib/metrics/aggregator.ts`, update `findDashboardOrders` to select `orderCreatedAt` and fetch by creation date (with a null-fallback to `placedAt`), so orders created in-window but paid later are included. Replace the `where` construction and the main `select`:

```ts
async function findDashboardOrders(
  input: DashboardSnapshotQueryInput,
): Promise<DashboardOrderRow[]> {
  const gte = brtBound(input.period.comparison.from);
  const lt = brtBound(dayAfter(input.period.to));
  const where = {
    workspaceId: input.workspaceId,
    platform: {
      in: input.commerceProviders,
    },
    // Fetch by CREATION date (the revenue bucket) when populated; fall back to
    // placedAt for legacy rows whose orderCreatedAt is still null. This catches
    // orders created in-window but paid later (placedAt outside the window).
    // BRT day window (UTC-3): bounds shifted +3h; precise per-day bucketing
    // happens in-memory via brtDateKey/isWithinBrt(orderRevenueDate).
    OR: [
      { orderCreatedAt: { gte, lt } },
      { orderCreatedAt: null, placedAt: { gte, lt } },
    ],
  };

  try {
    return await prisma.ecommerceOrder.findMany({
      where,
      select: {
        connectorAccountId: true,
        platform: true,
        orderTotal: true,
        itemsCount: true,
        status: true,
        shippingState: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        placedAt: true,
        orderCreatedAt: true,
      },
    });
  } catch (error) {
    if (!isMissingDashboardSchemaError(error)) {
      throw error;
    }

    const legacyOrders = await prisma.ecommerceOrder.findMany({
      where,
      select: {
        connectorAccountId: true,
        platform: true,
        orderTotal: true,
        itemsCount: true,
        status: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        placedAt: true,
      },
    });

    return legacyOrders.map((order) => ({
      ...order,
      status: order.status,
      shippingState: null,
      orderCreatedAt: null,
    }));
  }
}
```

> Rollout requires the migration (Task 1) to be deployed before this code. If `orderCreatedAt` were missing, both queries raise `P2022` and `getDashboardSnapshot`'s outer catch already degrades to a zeroed `schema_error` snapshot.

- [ ] **Step 6: Bucket the daily-summary + DB recompute by `orderCreatedAt`**

In `src/lib/connectors/ecommerce-sync.ts`, update `mapEcommerceOrdersToDailyMetricSummaries` so the day key uses the creation date with fallback (change only the `day` line inside the loop):

```ts
  for (const order of input.orders) {
    if (!isApprovedOrderStatus(order.status, input.provider)) continue;
    // Bucket by creation date (revenue report basis); fall back to placedAt for
    // rows without a creation date.
    const bucketDate = order.orderCreatedAt ?? order.placedAt;
    const day = bucketDate.slice(0, 10);
    const current = byDay.get(day) ?? { revenue: new Decimal(0), orders: 0 };
    current.revenue = current.revenue.plus(order.orderTotal);
    current.orders +=
      input.provider === ConnectorProvider.GOOGLE_SHEETS
        ? Math.max(0, order.itemsCount)
        : 1;
    byDay.set(day, current);
  }
```

Then update `recomputeEcommerceDailyMetricsFromDb` to select `orderCreatedAt`, widen the fetch window to creation-or-placed, and map the field into the `ShopifyOrder` objects. Replace the `findMany` + mapping:

```ts
async function recomputeEcommerceDailyMetricsFromDb(input: {
  workspaceId: string;
  connectorAccountId: string;
  provider: ConnectorProvider;
  since: string;
  until: string;
}) {
  const gte = asDateOnly(input.since);
  // until is the window's last day; cover the whole day (lt next day).
  const lt = new Date(asDateOnly(input.until).getTime() + 24 * 60 * 60 * 1000);
  const rows = await prisma.ecommerceOrder.findMany({
    where: {
      connectorAccountId: input.connectorAccountId,
      OR: [
        { orderCreatedAt: { gte, lt } },
        { orderCreatedAt: null, placedAt: { gte, lt } },
      ],
    },
    select: {
      externalOrderId: true,
      orderTotal: true,
      itemsCount: true,
      status: true,
      placedAt: true,
      orderCreatedAt: true,
    },
  });

  const orders: ShopifyOrder[] = rows.map((row) => ({
    externalOrderId: row.externalOrderId,
    orderNumber: null,
    orderTotal: row.orderTotal.toString(),
    orderCurrency: "BRL",
    customerEmail: null,
    itemsCount: row.itemsCount,
    status: row.status,
    placedAt: row.placedAt.toISOString(),
    orderCreatedAt: row.orderCreatedAt ? row.orderCreatedAt.toISOString() : null,
  }));

  await writeDailyMetricsFromOrders({
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    provider: input.provider,
    orders,
  });
}
```

> The commerce `dailyMetric` rollup is write-only (the dashboard reads `EcommerceOrder` live via `findDashboardOrders`), so this recompute keeps its existing UTC-day keying — the acceptance number flows through `buildDashboardSnapshot`, which is BRT-correct.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/unit/dashboard-aggregator.test.ts && npm run typecheck`
Expected: PASS — the new case reports revenue `150`, all pre-existing aggregator cases still pass, typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/metrics/aggregator.ts src/lib/connectors/ecommerce-sync.ts tests/unit/dashboard-aggregator.test.ts
git commit -m "feat: bucket ecommerce revenue by orderCreatedAt with placedAt fallback"
```

---

## Task 6: Recurring sync — incremental by `updated_at` for NuvemShop

**Files:**
- Modify: `src/lib/connectors/sync-range.ts:37-40` (`SyncRange`), add `computeIncrementalRange`
- Modify: `src/lib/connectors/sync-helpers.ts:9-17` (`SyncHelperInput`)
- Modify: `src/lib/connectors/ecommerce-sync.ts:58-61` (`EcommerceSyncRange`), `:487-514` (NuvemShop `listOrders` call)
- Modify: `src/lib/workspace/sync-orchestrator.ts:9-13` (import), `:204-210` (accounts select), `:225-240` (Phase 1 loop)
- Test: `tests/unit/sync-range.test.ts`, `tests/unit/sync-orchestrator.test.ts`

**Interfaces:**
- Consumes: `todayIso(now)` (existing), `computeForegroundRange()` (existing), `client.listOrders({ dateField, paidOnly })` (Task 3).
- Produces:
  - `SyncRange` / `EcommerceSyncRange` / `SyncHelperInput.range` gain optional `dateField?: "created_at" | "updated_at"` and `paidOnly?: boolean`.
  - `export function computeIncrementalRange(input: { lastSyncedAt: Date | null; now?: Date; overlapMs?: number; firstRunDays?: number }): SyncRange` returning `{ since, until, dateField: "updated_at", paidOnly: false }`.
  - `export const INCREMENTAL_OVERLAP_MS`, `export const INCREMENTAL_FIRST_RUN_DAYS`.

- [ ] **Step 1: Write the failing test for `computeIncrementalRange`**

Add to `tests/unit/sync-range.test.ts` (add `computeIncrementalRange`, `INCREMENTAL_OVERLAP_MS`, `INCREMENTAL_FIRST_RUN_DAYS` to the existing import from `@/lib/connectors/sync-range`):

```ts
describe("computeIncrementalRange", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");

  it("re-scans from lastSyncedAt minus the overlap, by updated_at", () => {
    const range = computeIncrementalRange({
      lastSyncedAt: new Date("2026-06-30T09:00:00.000Z"),
      now,
    });
    // 48h overlap before lastSyncedAt.
    expect(range.since).toBe("2026-06-28T09:00:00.000Z");
    expect(range.until).toBe("2026-07-01T23:59:59.999Z");
    expect(range.dateField).toBe("updated_at");
    expect(range.paidOnly).toBe(false);
  });

  it("falls back to a lookback window on first run (no lastSyncedAt)", () => {
    const range = computeIncrementalRange({ lastSyncedAt: null, now });
    // 35 days before now.
    expect(range.since.slice(0, 10)).toBe("2026-05-27");
    expect(range.dateField).toBe("updated_at");
    expect(range.paidOnly).toBe(false);
  });

  it("constants reflect business rules", () => {
    expect(INCREMENTAL_OVERLAP_MS).toBe(48 * 60 * 60 * 1000);
    expect(INCREMENTAL_FIRST_RUN_DAYS).toBe(35);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sync-range.test.ts -t "computeIncrementalRange"`
Expected: FAIL — `computeIncrementalRange` is not exported (import error).

- [ ] **Step 3: Add `dateField`/`paidOnly` to `SyncRange` and implement `computeIncrementalRange`**

In `src/lib/connectors/sync-range.ts`, extend the `SyncRange` type and add the function + constants (after `computeForegroundRange`):

```ts
export type SyncRange = {
  since: string;
  until: string;
  // When "updated_at", the source API is filtered by update time (incremental
  // recurring sync) instead of creation time (historical backfill). NuvemShop
  // only; other providers ignore it. Defaults to "created_at".
  dateField?: "created_at" | "updated_at";
  // When false, pull all payment statuses (status=any) so pending→paid and
  // paid→refunded transitions are captured. Defaults to true (paid only).
  paidOnly?: boolean;
};
```

```ts
/**
 * Overlap re-scanned before lastSyncedAt so an order updated right around the
 * previous sync boundary is not missed. 48h absorbs clock skew and cron gaps.
 */
export const INCREMENTAL_OVERLAP_MS = 48 * 60 * 60 * 1000;

/**
 * First-run lookback when the connector has never synced: cover the current and
 * previous month by update time so recent late-paid orders are captured.
 */
export const INCREMENTAL_FIRST_RUN_DAYS = 35;

/**
 * Recurring incremental window by UPDATE time. Replaces the "current UTC month
 * by created_at" foreground window for NuvemShop: an order created earlier and
 * paid now has a fresh updated_at, so it is re-fetched and its status updated —
 * fixing the late-payment gap. Historical loads still use computeBackfillBatch
 * (by created_at).
 */
export function computeIncrementalRange(input: {
  lastSyncedAt: Date | null;
  now?: Date;
  overlapMs?: number;
  firstRunDays?: number;
}): SyncRange {
  const now = input.now ?? new Date();
  const overlapMs = input.overlapMs ?? INCREMENTAL_OVERLAP_MS;
  const firstRunDays = input.firstRunDays ?? INCREMENTAL_FIRST_RUN_DAYS;
  const sinceDate = input.lastSyncedAt
    ? new Date(input.lastSyncedAt.getTime() - overlapMs)
    : new Date(now.getTime() - firstRunDays * 24 * 60 * 60 * 1000);
  return {
    since: sinceDate.toISOString(),
    until: todayIso(now),
    dateField: "updated_at",
    paidOnly: false,
  };
}
```

- [ ] **Step 4: Widen the range types on the helper and ecommerce sync**

In `src/lib/connectors/sync-helpers.ts`, widen `SyncHelperInput.range`:

```ts
export type SyncHelperInput = {
  connectorAccountId: string;
  range: {
    since: string;
    until: string;
    dateField?: "created_at" | "updated_at";
    paidOnly?: boolean;
  };
  deadlineMs?: number;
};
```

In `src/lib/connectors/ecommerce-sync.ts`, widen `EcommerceSyncRange`:

```ts
export type EcommerceSyncRange = {
  since: string;
  until: string;
  dateField?: "created_at" | "updated_at";
  paidOnly?: boolean;
};
```

- [ ] **Step 5: Thread `dateField`/`paidOnly` into the NuvemShop fetch**

In `src/lib/connectors/ecommerce-sync.ts`, in the `NUVEMSHOP` block of `loadOrdersForConnector`, pass the range's flags into `client.listOrders` (add the two lines to the existing call, alongside `startPage`):

```ts
      result = await client.listOrders({
        storeId: connector.externalAccountId,
        accessToken: input.accessToken,
        since: input.range.since,
        until: input.range.until,
        deadlineMs: input.deadlineMs,
        startPage,
        dateField: input.range.dateField,
        paidOnly: input.range.paidOnly,
        onPage: async (pageOrders) => {
          await persistOrdersOnly({
            workspaceId: connector.workspaceId,
            connectorAccountId: connector.id,
            provider: ConnectorProvider.NUVEMSHOP,
            orders: pageOrders,
          });
          persistedCount += pageOrders.length;
          pagesDone += 1;
          liveMeta = {
            ...liveMeta,
            isetBackfillOffsets: {
              ...readBackfillOffsets(liveMeta),
              [input.range.since]: startPage + pagesDone,
            },
          };
          await persistMeta();
        },
      });
```

- [ ] **Step 6: Drive the orchestrator's NuvemShop foreground with the incremental range**

In `src/lib/workspace/sync-orchestrator.ts`, add `computeIncrementalRange` to the sync-range import:

```ts
import {
  backfillBatchMonthsFor,
  computeBackfillBatch,
  computeForegroundRange,
  computeIncrementalRange,
} from "@/lib/connectors/sync-range";
```

Add `lastSyncedAt: true` to the accounts `select` (in `runWorkspaceSync`):

```ts
      select: {
        id: true,
        provider: true,
        historicalSyncedAt: true,
        historicalBackfillUntil: true,
        lastSyncedAt: true,
      },
```

Then, in the Phase 1 foreground loop, choose the range per provider (replace the `helper({ ... })` call):

```ts
    const syncable = accounts.filter((a) => SYNC_HELPERS[a.provider]);
    for (const account of syncable) {
      const helper = SYNC_HELPERS[account.provider]!;
      // NuvemShop syncs incrementally by updated_at (status=any) so late-paid
      // orders are re-fetched; other providers keep the created_at foreground
      // window (their clients don't support updated_at filtering).
      const range =
        account.provider === ConnectorProvider.NUVEMSHOP
          ? computeIncrementalRange({ lastSyncedAt: account.lastSyncedAt })
          : computeForegroundRange();
      try {
        await helper({
          connectorAccountId: account.id,
          range,
          deadlineMs: hardDeadline,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown";
        errors.push(`${account.provider} foreground: ${message}`);
      }
    }
```

- [ ] **Step 7: Update the orchestrator test (select assertion) and add a NuvemShop-range test**

In `tests/unit/sync-orchestrator.test.ts`, first make the mocked `SYNC_HELPERS` expose a NuvemShop spy. Extend the `vi.hoisted` block and the sync-helpers mock:

```ts
const { prismaMocks, helperMocks } = vi.hoisted(() => ({
  prismaMocks: {
    workspace: { findUnique: vi.fn() },
    connectorAccount: { count: vi.fn(), findMany: vi.fn() },
    workspaceSyncState: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
  helperMocks: { nuvemshop: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: prismaMocks,
}));

vi.mock("@/lib/connectors/sync-helpers", () => ({
  SYNC_HELPERS: { NUVEMSHOP: helperMocks.nuvemshop },
  isoDaysAgo: (n: number) => `iso-${n}d`,
  todayIso: () => "iso-today",
}));
```

Add `ConnectorProvider` to the top import and reset the spy in `beforeEach`:

```ts
import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
```

```ts
beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.workspace.findUnique.mockResolvedValue({ id: "ws-1" });
  prismaMocks.connectorAccount.count.mockResolvedValue(2);
  prismaMocks.workspaceSyncState.upsert.mockResolvedValue({});
  prismaMocks.workspaceSyncState.update.mockResolvedValue({});
  prismaMocks.workspaceSyncState.findUnique.mockResolvedValue(null);
  prismaMocks.$queryRaw.mockResolvedValue([]);
  helperMocks.nuvemshop.mockResolvedValue({ complete: true, ordersCount: 0 });
});
```

Update the existing `select` assertion in `"loads retryable connectors (ACTIVE + ERROR) and historicalSyncedAt"` to include `lastSyncedAt: true`:

```ts
      select: {
        id: true,
        provider: true,
        historicalSyncedAt: true,
        historicalBackfillUntil: true,
        lastSyncedAt: true,
      },
```

Add a new test inside `describe("runWorkspaceSync", ...)`:

```ts
  it("syncs NuvemShop foreground incrementally by updated_at", async () => {
    prismaMocks.connectorAccount.findMany.mockResolvedValueOnce([
      {
        id: "nuvem-1",
        provider: ConnectorProvider.NUVEMSHOP,
        // Both set → excluded from backfill; only the foreground runs.
        historicalSyncedAt: new Date("2026-06-01T00:00:00.000Z"),
        historicalBackfillUntil: new Date("2023-06-01T00:00:00.000Z"),
        lastSyncedAt: new Date("2026-06-30T09:00:00.000Z"),
      },
    ]);

    await runWorkspaceSync("ws-1", { includeBackfill: false });

    expect(helperMocks.nuvemshop).toHaveBeenCalledTimes(1);
    const call = helperMocks.nuvemshop.mock.calls[0][0];
    expect(call.connectorAccountId).toBe("nuvem-1");
    expect(call.range.dateField).toBe("updated_at");
    expect(call.range.paidOnly).toBe(false);
  });
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/unit/sync-range.test.ts tests/unit/sync-orchestrator.test.ts && npm run typecheck`
Expected: PASS (all cases in both files) and typecheck exits 0.

- [ ] **Step 9: Commit**

```bash
git add src/lib/connectors/sync-range.ts src/lib/connectors/sync-helpers.ts src/lib/connectors/ecommerce-sync.ts src/lib/workspace/sync-orchestrator.ts tests/unit/sync-range.test.ts tests/unit/sync-orchestrator.test.ts
git commit -m "feat: drive NuvemShop recurring sync incrementally by updated_at"
```

> Steady state is now correct going forward. The **accumulated** historical gap (~26 June orders already missing, all legacy rows with null `orderCreatedAt`) is repaired once by Task 7 — the incremental window only re-scans recent updates.

---

## Task 7: One-time re-backfill script + Cotton Chic acceptance

**Files:**
- Create: `scripts/_qa-nuvemshop-reconcile.ts`
- Create: `scripts/_qa-nuvemshop-rebackfill.ts`

**Interfaces:**
- Consumes: `syncEcommerceOrders({ connectorAccountId, range, syncType })` (existing export), `isApprovedOrderStatus` (existing), Prisma `ecommerceOrder`.
- Produces: two runnable `tsx` scripts. `_qa-nuvemshop-reconcile.ts <connectorAccountId> <YYYY-MM>` prints the paid, non-cancelled `sum(orderTotal)` bucketed by `orderCreatedAt` (BRT) for the month. `_qa-nuvemshop-rebackfill.ts <connectorAccountId> [since] [until]` re-fetches all statuses by `created_at` and upserts (populating `orderCreatedAt`, ingesting missing late-paid orders).

> Run scripts with the production DB env loaded:
> `set -a; source .env; set +a` (ensure `DATABASE_URL` uses `?schema=w3ads` — the committed local value points at the empty `w3marketplace`). Run with `node --import tsx --env-file=.env scripts/<file>.ts ...`.
> Find the Cotton Chic connector id first:
> `psql "$DATABASE_URL" -c "SELECT id, \"accountName\" FROM w3ads.\"ConnectorAccount\" WHERE provider='NUVEMSHOP' AND \"accountName\" ILIKE '%cotton%';"`

- [ ] **Step 1: Write the reconcile (acceptance) script**

Create `scripts/_qa-nuvemshop-reconcile.ts`:

```ts
import { PrismaClient } from "@prisma/client";

import { isApprovedOrderStatus } from "../src/lib/metrics/order-status";

const prisma = new PrismaClient();
const cid = process.argv[2];
const month = process.argv[3]; // "2026-06"
if (!cid || !month || !/^\d{4}-\d{2}$/.test(month)) {
  console.error(
    "usage: tsx _qa-nuvemshop-reconcile.ts <connectorAccountId> <YYYY-MM>",
  );
  process.exit(1);
}

// BRT (UTC-3) month boundaries expressed in UTC:
// [YYYY-MM-01T03:00:00Z, next-month-01T03:00:00Z).
const [y, m] = month.split("-").map(Number);
const startUtc = new Date(Date.UTC(y, m - 1, 1, 3, 0, 0));
const endUtc = new Date(Date.UTC(y, m, 1, 3, 0, 0));

// Mirror the aggregator exactly: bucket by orderCreatedAt when populated, else
// fall back to placedAt. Before the re-backfill every row still has a NULL
// orderCreatedAt, so the fallback reproduces the current (under-reported)
// dashboard number; after it, the created-date rows drive the correct total.
const rows = await prisma.ecommerceOrder.findMany({
  where: {
    connectorAccountId: cid,
    OR: [
      { orderCreatedAt: { gte: startUtc, lt: endUtc } },
      { orderCreatedAt: null, placedAt: { gte: startUtc, lt: endUtc } },
    ],
  },
  select: {
    orderTotal: true,
    status: true,
    orderCreatedAt: true,
    placedAt: true,
  },
});

let total = 0;
let paidCount = 0;
for (const r of rows) {
  // Paid & non-cancelled (isApprovedOrderStatus already excludes cancelled/
  // refunded/void). total == total_paid, so orderTotal is the revenue.
  if (isApprovedOrderStatus(r.status, "NUVEMSHOP")) {
    total += Number(r.orderTotal);
    paidCount += 1;
  }
}

console.log(`Connector ${cid} — ${month} (by orderCreatedAt ?? placedAt, BRT)`);
console.log(`  rows in window: ${rows.length}`);
console.log(`  paid & non-cancelled: ${paidCount}`);
console.log(`  revenue: R$ ${total.toFixed(2)}`);

await prisma.$disconnect();
```

- [ ] **Step 2: Run the reconcile BEFORE the fix (capture the wrong number)**

Run: `node --import tsx --env-file=.env scripts/_qa-nuvemshop-reconcile.ts <cottonChicConnectorAccountId> 2026-06`
Expected (RED baseline): revenue ≈ `R$ 31640.09` with `paid & non-cancelled ≈ 77`. Every existing row still has `orderCreatedAt = NULL`, so the script falls back to `placedAt` (reproducing today's under-reported dashboard number) and the ~26 late-paid, June-created orders are either bucketed into July (by their `paid_at` placedAt) or not in the DB at all.

- [ ] **Step 3: Write the re-backfill script**

Create `scripts/_qa-nuvemshop-rebackfill.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const cid = process.argv[2];
const since = process.argv[3] ?? "2026-01-01";
const until = process.argv[4] ?? new Date().toISOString().slice(0, 10);
if (!cid) {
  console.error(
    "usage: tsx _qa-nuvemshop-rebackfill.ts <connectorAccountId> [since=2026-01-01] [until=today]",
  );
  process.exit(1);
}

const acc = await prisma.connectorAccount.findUnique({
  where: { id: cid },
  select: { id: true, provider: true, accountName: true },
});
if (!acc || acc.provider !== "NUVEMSHOP") {
  console.error("connector not found or not NUVEMSHOP");
  process.exit(1);
}

console.log(
  `Re-backfilling ${acc.accountName} (${cid}) by created_at, status=any: ${since} → ${until}`,
);

const { syncEcommerceOrders } = await import(
  "../src/lib/connectors/ecommerce-sync"
);

const start = Date.now();
// created_at window + paidOnly:false re-fetches EVERY order created in the
// window (including the ones that only became paid later) and upserts them,
// populating orderCreatedAt on existing rows and inserting the missing ones.
const result = await syncEcommerceOrders({
  connectorAccountId: cid,
  range: { since, until, dateField: "created_at", paidOnly: false },
  syncType: "BACKFILL",
});
console.log(
  `  done in ${((Date.now() - start) / 1000).toFixed(1)}s`,
  result,
);

await prisma.$disconnect();
```

- [ ] **Step 4: Run the re-backfill**

Run: `node --import tsx --env-file=.env scripts/_qa-nuvemshop-rebackfill.ts <cottonChicConnectorAccountId> 2026-01-01`
Expected: prints `done in <n>s { complete: true, ordersCount: <>0 }` (no thrown error). If `complete: false` (deadline/pagination cut), re-run — it resumes by page.

- [ ] **Step 5: Run the reconcile AFTER the fix (acceptance — GREEN)**

Run: `node --import tsx --env-file=.env scripts/_qa-nuvemshop-reconcile.ts <cottonChicConnectorAccountId> 2026-06`
Expected (GREEN): `revenue: R$ 43922.29` (± later refunds), `paid & non-cancelled ≈ 102`. This is the design's acceptance criterion.

- [ ] **Step 6: Commit**

```bash
git add scripts/_qa-nuvemshop-reconcile.ts scripts/_qa-nuvemshop-rebackfill.ts
git commit -m "chore: add NuvemShop reconcile + one-time re-backfill scripts"
```

---

## Task 8: End-to-end reconciliation test + full green gate

**Files:**
- Create: `tests/unit/nuvemshop-reconciliation.test.ts`

**Interfaces:**
- Consumes: `buildDashboardSnapshot` (aggregator, Task 5), `mapEcommerceOrdersToDailyMetricSummaries` (ecommerce-sync, Task 5), `getDashboardPeriod` (period).
- Produces: a test proving a mixed dataset (created-June/paid-July, empty-paid_at fallback, cancelled, BRT boundary, other-month) aggregates by creation date to the exact expected total, in both the live dashboard path and the daily-summary rollup.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/nuvemshop-reconciliation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConnectorProvider } from "@prisma/client";

import { buildDashboardSnapshot } from "@/lib/metrics/aggregator";
import { mapEcommerceOrdersToDailyMetricSummaries } from "@/lib/connectors/ecommerce-sync";
import { getDashboardPeriod } from "@/lib/metrics/period";
import type { ShopifyOrder } from "@/lib/connectors/shopify/client";

describe("NuvemShop June reconciliation by creation date", () => {
  const period = getDashboardPeriod(
    { period: "custom", from: "2026-06-01", to: "2026-06-30" },
    new Date("2026-07-15T12:00:00.000Z"),
  );

  it("sums paid, non-cancelled orders by orderCreatedAt (dashboard path)", () => {
    const snapshot = buildDashboardSnapshot({
      period,
      commerceProviders: [ConnectorProvider.NUVEMSHOP],
      metrics: [],
      orders: [
        // Created June, paid July → counts in June.
        {
          connectorAccountId: "n1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "500.00",
          status: "paid",
          orderCreatedAt: new Date("2026-06-10T13:00:00.000Z"),
          placedAt: new Date("2026-07-05T13:00:00.000Z"),
        },
        // paid_at empty → placedAt fell back to created_at (June); orderCreatedAt set.
        {
          connectorAccountId: "n1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "250.50",
          status: "paid",
          orderCreatedAt: new Date("2026-06-18T13:00:00.000Z"),
          placedAt: new Date("2026-06-18T13:00:00.000Z"),
        },
        // Cancelled → excluded.
        {
          connectorAccountId: "n1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "1000.00",
          status: "cancelado",
          orderCreatedAt: new Date("2026-06-02T13:00:00.000Z"),
          placedAt: new Date("2026-06-02T13:00:00.000Z"),
        },
        // BRT boundary: 2026-06-30 23:30 BRT = 2026-07-01T02:30Z → June.
        {
          connectorAccountId: "n1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "49.50",
          status: "paid",
          orderCreatedAt: new Date("2026-07-01T02:30:00.000Z"),
          placedAt: new Date("2026-07-01T02:30:00.000Z"),
        },
        // Created May → excluded from June.
        {
          connectorAccountId: "n1",
          platform: ConnectorProvider.NUVEMSHOP,
          orderTotal: "777.00",
          status: "paid",
          orderCreatedAt: new Date("2026-05-31T13:00:00.000Z"),
          placedAt: new Date("2026-06-01T13:00:00.000Z"),
        },
      ],
    });

    // 500 + 250.50 + 49.50 = 800.00.
    expect(snapshot.kpis.revenue.value).toBe(800);
    expect(snapshot.kpis.approvedOrders.value).toBe(3);
  });

  it("buckets the daily rollup by orderCreatedAt with placedAt fallback", () => {
    const orders: ShopifyOrder[] = [
      {
        externalOrderId: "a",
        orderNumber: null,
        orderTotal: "500.00",
        orderCurrency: "BRL",
        customerEmail: null,
        itemsCount: 1,
        status: "paid",
        orderCreatedAt: "2026-06-10T13:00:00.000Z",
        placedAt: "2026-07-05T13:00:00.000Z",
      },
      {
        externalOrderId: "b",
        orderNumber: null,
        orderTotal: "40.00",
        orderCurrency: "BRL",
        customerEmail: null,
        itemsCount: 1,
        status: "paid",
        orderCreatedAt: null,
        placedAt: "2026-06-20T13:00:00.000Z",
      },
    ];

    const summaries = mapEcommerceOrdersToDailyMetricSummaries({
      workspaceId: "w",
      connectorAccountId: "n1",
      provider: ConnectorProvider.NUVEMSHOP,
      orders,
    });

    const byDay = new Map(summaries.map((s) => [s.day, s.revenue]));
    // "a" buckets under its creation date (June 10), not the July paid date.
    expect(byDay.get("2026-06-10")).toBe("500.00");
    // "b" (null creation) falls back to placedAt (June 20).
    expect(byDay.get("2026-06-20")).toBe("40.00");
    expect(byDay.has("2026-07-05")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (code already landed in Task 5)**

Run: `npx vitest run tests/unit/nuvemshop-reconciliation.test.ts`
Expected: PASS. (If either case fails, the Task 5 aggregator/summary edits are incomplete — fix there, not in the test.)

- [ ] **Step 3: Full suite + typecheck gate**

Run: `npx vitest run && npm run typecheck`
Expected: entire unit suite green, `tsc --noEmit` exits 0.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/nuvemshop-reconciliation.test.ts
git commit -m "test: end-to-end NuvemShop created-date revenue reconciliation"
```

---

## Rollout order (from the design)

1. Deploy Task 1 migration (`npx prisma migrate deploy` / `npm run build`) — column exists before code.
2. Deploy Tasks 2–6 code (backward-compatible: `orderCreatedAt` nullable, aggregation falls back to `placedAt`).
3. Run Task 7 re-backfill for Cotton Chic (and any other NuvemShop connectors) to populate `orderCreatedAt` + ingest missing orders.
4. Verify Cotton Chic June == R$ 43.922,29 (Task 7 reconcile).
5. (Future, out of scope) Remove the `placedAt` fallback once `orderCreatedAt` is populated 100%.

## Notes, risks & gaps found while mapping code → design

- **`prisma/migrations/migration_lock.toml` appears absent.** If `prisma migrate deploy` errors on a missing lock file, create it (`provider = "postgresql"`) — covered in Task 1 Step 3.
- **Migration schema-qualification is inconsistent in the repo** (some migrations use `"w3ads"."EcommerceOrder"`, others unqualified `"ConnectorAccount"`). The plan qualifies with `w3ads` to match the existing `EcommerceOrder` index migration. This is a **prod-schema (`w3ads`) migration**; running it locally against the `w3marketplace` schema would fail — do local DB work against `w3ads`.
- **`ordersUrl` truncates dates to `YYYY-MM-DD`**, so the 48h incremental overlap effectively rounds to whole days (re-scan from `lastSyncedAt` date − 2d). This is intentional (NuvemShop's date filter is day-granular here) and safe (overlap only widens the window).
- **Commerce `dailyMetric` is write-only** — the dashboard reads `EcommerceOrder` live via `findDashboardOrders`, so the acceptance number flows through `buildDashboardSnapshot` (BRT-correct). The recompute keeps UTC-day keying to avoid a double BRT shift; this is a deliberate scope limit, not a bug.
- **Incremental sync fixes steady-state only.** The accumulated historical gap (null `orderCreatedAt` on all legacy rows + ~26 missing June orders) is repaired only by the Task 7 one-time re-backfill. Without Task 7 the dashboard stays under-reported for past months.
- **The `updated_at` incremental path is NuvemShop-only.** Other e-commerce connectors keep the `created_at` foreground window (their clients don't support `updated_at`). If the same under-reporting is later observed on iSET/Shopee/etc., the same pattern (Tasks 3 + 6) must be applied per provider — out of scope here.
- **Line items (`filteredOrderItems`) still bucket by `placedAt`.** They feed the products/categories widgets, not the headline revenue KPI, and carry no creation date. If per-item widgets must also follow creation date, `orderCreatedAt` would need to propagate to `EcommerceOrderItem` — out of scope.
- **`findDashboardOrders` legacy-catch path** reuses the `orderCreatedAt`-referencing `where`; it is only reachable when the column is missing (pre-migration), in which case `getDashboardSnapshot` degrades to a zeroed `schema_error` snapshot. Rollout order (migration first) avoids this.
- **DEVIATION — Task 7 re-backfill uses `created_at`, not `updated_at`.** The design (§3.5) says "re-backfill por updated_at/status=any". The plan re-fetches by **`created_at`/status=any** over a wide window because the acceptance criterion is defined by creation date: fetching by `created_at` guarantees every June-created order (any payment status) is pulled and its `orderCreatedAt` populated in one pass, which is exactly the ground-truth set NuvemShop counts for June. An `updated_at` window would repair by modification time and could miss an old order created in-window but never touched since. The recurring/steady-state sync still uses `updated_at` per the design (Task 6). If the executor prefers strict adherence, pass a wide `updated_at` window instead — both converge for a full historical pass, but `created_at` is the cleaner one-shot repair.
- **RISK — order-level "cancelled" relies on `payment_status`.** The design's revenue rule is "payment_status ∈ APROVADOS **and** status != cancelled". The normalizer stores a single `status = order.payment_status ?? order.status`, so `isApprovedOrderStatus` decides on payment status alone. In practice NuvemShop flips `payment_status` to `refunded`/`voided` on cancellation (both in `REJECTED_TERMS`), so the common case is handled. The uncovered edge is an order that is `payment_status="paid"` **and** order-level `status="cancelled"` without a refund — rare, and it would *over*-count, whereas the observed bug is *under*-counting. If exact parity with the design's dual condition is required, capture the order-level `status` as a separate `EcommerceOrder` column and add it to the aggregation predicate — out of scope for this fix (would add a column + migration).
