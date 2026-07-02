import { createHash } from "node:crypto";
import {
  ConnectorProvider,
  ConnectorStatus,
  Prisma,
  SyncStatus,
} from "@prisma/client";
import Decimal from "decimal.js";
import * as Sentry from "@sentry/nextjs";

import { isApprovedOrderStatus } from "@/lib/metrics/order-status";
import { IsetClient } from "@/lib/connectors/iset/client";
import {
  supportsInventory,
  syncConnectorInventory,
} from "@/lib/connectors/inventory-sync";
import { syncMercadoLivreVisits } from "@/lib/connectors/visits-sync";
import { normalizeManualCommerceOrder } from "@/lib/connectors/manual-commerce";
import {
  connectorAccessTokenFromAccount,
  connectorCredentialsFromAccountVaultAware,
  connectorRefreshTokenFromAccount,
  vaultCredentialFields,
} from "@/lib/connectors/credentials";
import { getGlobalMercadoLivreConfig } from "@/lib/connectors/mercado-livre/global-config";
import {
  MERCADO_LIVRE_ORDERS_PAGE_SIZE,
  MercadoLivreClient,
} from "@/lib/connectors/mercado-livre/client";
import {
  NuvemshopApiError,
  NuvemshopClient,
} from "@/lib/connectors/nuvemshop/client";
import { getGlobalShopeeConfig } from "@/lib/connectors/shopee/global-config";
import { ShopeeClient } from "@/lib/connectors/shopee/client";
import {
  ConnectorRefreshError,
  classifyConnectorSyncError,
  grantStillDeadAfterRecheck,
  isAuthFatalError,
  statusForSyncFailure,
} from "@/lib/connectors/sync-error";
import { ShopifyClient } from "@/lib/connectors/shopify/client";
import {
  buildMercadoLivreConfigFromProviderConfig,
  buildNuvemshopConfigFromProviderConfig,
  buildShopeeConfigFromProviderConfig,
  buildShopifyConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
import type { ShopifyOrder } from "@/lib/connectors/shopify/client";
import { prisma } from "@/lib/db/prisma";
import {
  buildSyncJobCreateInput,
  type ProductionSyncType,
} from "@/lib/jobs/sync-operations";

import { ManualCommerceClient } from "./manual-commerce-client";

export type EcommerceSyncRange = {
  since: string;
  until: string;
  dateField?: "created_at" | "updated_at";
  paidOnly?: boolean;
};

const ORDER_PERSIST_CONCURRENCY = 10;

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function asDateOnly(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

export function ecommerceDailyDedupeHash(input: {
  workspaceId: string;
  connectorAccountId: string;
  provider: ConnectorProvider;
  date: string;
}) {
  return createHash("sha256")
    .update(
      [
        input.workspaceId,
        input.connectorAccountId,
        input.provider,
        input.date,
      ].join(":"),
    )
    .digest("hex");
}

export function mapEcommerceOrdersToDailyMetricSummaries(input: {
  workspaceId: string;
  connectorAccountId: string;
  provider: ConnectorProvider;
  orders: ShopifyOrder[];
}) {
  const byDay = new Map<string, { revenue: Decimal; orders: number }>();

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

  return Array.from(byDay.entries()).map(([day, summary]) => ({
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    date: asDateOnly(day),
    day,
    source: input.provider,
    revenue: summary.revenue.toFixed(2),
    orders: BigInt(summary.orders),
    dedupeHash: ecommerceDailyDedupeHash({
      workspaceId: input.workspaceId,
      connectorAccountId: input.connectorAccountId,
      provider: input.provider,
      date: day,
    }),
  }));
}

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

/**
 * Defensive guard against upstream providers returning malformed or empty
 * timestamps (e.g., MySQL "0000-00-00" or refund-only rows). Returns null on
 * invalid input — callers must skip the order (storing `now` would silently
 * inflate today's metrics with phantom orders).
 */
function parsePlacedAt(value: string): Date | null {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts) : null;
}

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

function mapEcommerceOrderItemsToRecords(input: {
  workspaceId: string;
  connectorAccountId: string;
  ecommerceOrderId: string;
  order: ShopifyOrder;
  placedAt: Date;
}) {
  return (input.order.items ?? []).map((item) => ({
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    ecommerceOrderId: input.ecommerceOrderId,
    externalOrderId: input.order.externalOrderId,
    productName: item.productName,
    sku: item.sku,
    quantity: item.quantity,
    total: item.total,
    placedAt: input.placedAt,
  }));
}

/**
 * Upserts orders into EcommerceOrder (idempotent by connectorAccountId +
 * externalOrderId) WITHOUT touching dailyMetric. Extracted so the iSET
 * incremental path can persist page-by-page (kill-safe) and recompute
 * dailyMetric separately. Returns the orders that were actually ingested
 * (invalid-date rows skipped) so callers can aggregate from them.
 */
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

/** Upserts the per-day dailyMetric rollup for the given orders (set semantics
 * keyed by dedupeHash, so idempotent across re-syncs). */
async function writeDailyMetricsFromOrders(input: {
  workspaceId: string;
  connectorAccountId: string;
  provider: ConnectorProvider;
  orders: ShopifyOrder[];
}) {
  const summaries = mapEcommerceOrdersToDailyMetricSummaries({
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    provider: input.provider,
    orders: input.orders,
  });
  for (const summary of summaries) {
    await prisma.dailyMetric.upsert({
      where: { dedupeHash: summary.dedupeHash },
      update: {
        revenue: summary.revenue,
        orders: summary.orders,
      },
      create: {
        workspaceId: input.workspaceId,
        connectorAccountId: input.connectorAccountId,
        date: summary.date,
        source: input.provider,
        revenue: summary.revenue,
        orders: summary.orders,
        dedupeHash: summary.dedupeHash,
      },
    });
  }
}

async function persistEcommerceOrders(input: {
  workspaceId: string;
  connectorAccountId: string;
  provider: ConnectorProvider;
  orders: ShopifyOrder[];
}) {
  const { ingestedOrders } = await persistOrdersOnly(input);
  await writeDailyMetricsFromOrders({ ...input, orders: ingestedOrders });
}

/**
 * Recomputes the ecommerce dailyMetric rollup for [since, until] FROM the
 * orders already persisted in the DB (not from an in-memory batch). The iSET
 * incremental path upserts orders page-by-page, so the daily rollup can't be
 * derived from a single batch — re-deriving from the DB is correct regardless
 * of how the window was chunked across resumable runs, and idempotent. The
 * dashboard reads EcommerceOrder live, so ecommerce dailyMetric is write-only;
 * this is therefore best-effort (callers wrap it in try/catch).
 */
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
    orderCreatedAt: row.orderCreatedAt
      ? row.orderCreatedAt.toISOString()
      : null,
  }));

  await writeDailyMetricsFromOrders({
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    provider: input.provider,
    orders,
  });
}

/**
 * iSET backfill resume offsets, keyed by window `since` (ISO). Stored as a MAP
 * (not a single key) because the manual sync route runs the foreground window
 * (current month) and then historical backfill windows within the same request:
 * a single shared offset slot would be overwritten/cleared by whichever window
 * completes first (the foreground always does), wiping the in-progress backfill
 * window's offset and restarting it from 0. A per-window map keeps each
 * window's progress independent; an entry is dropped when its window completes,
 * so the map self-cleans to ~1-2 live entries.
 */
function readBackfillOffsets(
  meta: Record<string, unknown>,
): Record<string, number> {
  const raw = meta.isetBackfillOffsets;
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        out[key] = value;
      }
    }
  }
  return out;
}

async function loadOrdersForConnector(input: {
  provider: ConnectorProvider;
  connectorAccountId: string;
  accessToken?: string;
  range: EcommerceSyncRange;
  // Absolute epoch-ms wall-clock budget. Only iSET (heavy, rate-limited,
  // paginated) honours it: it stops paginating before the deadline and reports
  // `complete: false` so the caller doesn't advance its backfill cursor.
  deadlineMs?: number;
}): Promise<{
  orders: ShopifyOrder[];
  complete: boolean;
  // Set by the iSET incremental path, which persists orders page-by-page and
  // returns them already-saved (orders: []). Callers use this for the SyncJob
  // row count instead of orders.length.
  persistedCount?: number;
}> {
  const connector = await prisma.connectorAccount.findUniqueOrThrow({
    where: { id: input.connectorAccountId },
  });

  if (input.provider === ConnectorProvider.NUVEMSHOP) {
    if (!input.accessToken) {
      throw new Error("Nuvemshop access token is missing");
    }
    const providerConfig = await getActiveProviderConfig({
      workspaceId: connector.workspaceId,
      provider: ConnectorProvider.NUVEMSHOP,
    });
    if (!providerConfig) {
      throw new Error("Nuvemshop provider config is missing");
    }
    const client = new NuvemshopClient({
      config: await buildNuvemshopConfigFromProviderConfig(providerConfig),
    });

    // High-volume Nuvemshop stores (many orders) overran the function limit when
    // listOrders fetched every page into memory then persisted once → killed
    // mid-flight, 0 orders. Stream + persist per page, deadline-bounded, and
    // resume by PAGE from the per-window offset map (same mechanism as iSET).
    const nuvemMeta =
      connector.metadata &&
      typeof connector.metadata === "object" &&
      !Array.isArray(connector.metadata)
        ? (connector.metadata as Record<string, unknown>)
        : {};
    let liveMeta: Record<string, unknown> = { ...nuvemMeta };
    const persistMeta = async () => {
      await prisma.connectorAccount.update({
        where: { id: connector.id },
        data: { metadata: liveMeta as Prisma.InputJsonObject },
      });
    };
    const savedPage = readBackfillOffsets(nuvemMeta)[input.range.since];
    const startPage = savedPage && savedPage >= 1 ? savedPage : 1;
    let persistedCount = 0;
    let pagesDone = 0;

    // Drops this window's saved resume page so the next run restarts at page 1.
    const clearResumeOffset = async () => {
      const remaining = readBackfillOffsets(liveMeta);
      if (!(input.range.since in remaining)) return;
      delete remaining[input.range.since];
      liveMeta = { ...liveMeta };
      if (Object.keys(remaining).length === 0) {
        delete liveMeta.isetBackfillOffsets;
      } else {
        liveMeta.isetBackfillOffsets = remaining;
      }
      await persistMeta();
    };

    let result: Awaited<ReturnType<typeof client.listOrders>>;
    try {
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
    } catch (caught) {
      // A 422 when resuming past page 1 means the saved resume page overran
      // Nuvemshop's pagination cap (a prior run paginated unfiltered and parked
      // the cursor far beyond the real data). Without clearing it, every future
      // run resumes the same out-of-range page and 422s forever. Drop the
      // offset so the next run restarts from page 1 and completes cleanly.
      if (
        caught instanceof NuvemshopApiError &&
        caught.status === 422 &&
        startPage > 1
      ) {
        await clearResumeOffset();
      }
      throw caught;
    }

    // Window fully fetched → drop this window's resume entry (leave others).
    if (result.complete) {
      await clearResumeOffset();
    }

    // Re-derive the dailyMetric rollup from the DB (orders persisted per page).
    // Best-effort: orders are already durable and the dashboard reads
    // EcommerceOrder live.
    try {
      await recomputeEcommerceDailyMetricsFromDb({
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        provider: ConnectorProvider.NUVEMSHOP,
        since: input.range.since,
        until: input.range.until,
      });
    } catch (recomputeErr) {
      console.warn(
        `[ecommerce-sync] Nuvemshop dailyMetric recompute failed (connector=${connector.id}): ${recomputeErr instanceof Error ? recomputeErr.message : "unknown"}`,
      );
    }

    return { orders: [], complete: result.complete, persistedCount };
  }

  if (input.provider === ConnectorProvider.MERCADO_LIVRE) {
    const sellerId = connector.externalAccountId;
    let accessToken = await connectorAccessTokenFromAccount(connector);
    const refreshToken = await connectorRefreshTokenFromAccount(connector);

    // Resolve OAuth config (workspace ProviderConfig first, env "app W3"
    // fallback). Needed only for proactive token refresh; listing orders just
    // needs the access token + seller id.
    const providerConfig = await getActiveProviderConfig({
      workspaceId: connector.workspaceId,
      provider: ConnectorProvider.MERCADO_LIVRE,
    });
    const config = providerConfig
      ? await buildMercadoLivreConfigFromProviderConfig(providerConfig)
      : getGlobalMercadoLivreConfig(process.env.NEXTAUTH_URL?.trim() ?? "");

    // ML access tokens live ~6h. Refresh proactively when the stored expiry is
    // within 5 min (or already past) and we hold a refresh token + config, then
    // re-vault the rotated credentials (createSecret upserts by deterministic
    // name, so the same vault entries are updated in place).
    const REFRESH_SKEW_MS = 5 * 60 * 1000;
    const expiresAtMs = connector.tokenExpiresAt
      ? connector.tokenExpiresAt.getTime()
      : null;
    const needsRefresh =
      expiresAtMs !== null && expiresAtMs - Date.now() <= REFRESH_SKEW_MS;
    if (needsRefresh) {
      if (!refreshToken || !config) {
        throw new Error(
          "Token do Mercado Livre expirado e sem refresh token ou config. Reconecte a integração.",
        );
      }
      const refreshClient = new MercadoLivreClient({ config });
      // A refresh failure is tagged so the outer handler can distinguish a dead
      // grant (→ TOKEN_EXPIRED, needs reconnect) from a transient token-endpoint
      // blip (→ keep ACTIVE, retry next run).
      let refreshed;
      try {
        refreshed = await refreshClient.refreshAccessToken(refreshToken);
      } catch (refreshErr: unknown) {
        throw new ConnectorRefreshError(
          isAuthFatalError(refreshErr),
          refreshErr,
        );
      }
      const credentialFields = await vaultCredentialFields({
        workspaceId: connector.workspaceId,
        provider: ConnectorProvider.MERCADO_LIVRE,
        externalAccountId: sellerId,
        credentials: { accessToken: refreshed.accessToken },
        refreshToken: refreshed.refreshToken ?? refreshToken,
        tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
      });
      await prisma.connectorAccount.update({
        where: { id: connector.id },
        data: { ...credentialFields, status: ConnectorStatus.ACTIVE },
      });
      accessToken = refreshed.accessToken;
    }

    const client = new MercadoLivreClient({ config });

    // Stream + persist per page, deadline-bounded, resuming by item offset from
    // the per-window offset map (same mechanism as Nuvemshop/iSET).
    const meliMeta =
      connector.metadata &&
      typeof connector.metadata === "object" &&
      !Array.isArray(connector.metadata)
        ? (connector.metadata as Record<string, unknown>)
        : {};
    let liveMeta: Record<string, unknown> = { ...meliMeta };
    const persistMeta = async () => {
      await prisma.connectorAccount.update({
        where: { id: connector.id },
        data: { metadata: liveMeta as Prisma.InputJsonObject },
      });
    };
    const savedOffset = readBackfillOffsets(meliMeta)[input.range.since];
    const startOffset = savedOffset && savedOffset >= 0 ? savedOffset : 0;
    let persistedCount = 0;
    let pagesDone = 0;

    // Drops this window's saved resume offset so the next run restarts at 0.
    const clearResumeOffset = async () => {
      const remaining = readBackfillOffsets(liveMeta);
      if (!(input.range.since in remaining)) return;
      delete remaining[input.range.since];
      liveMeta = { ...liveMeta };
      if (Object.keys(remaining).length === 0) {
        delete liveMeta.isetBackfillOffsets;
      } else {
        liveMeta.isetBackfillOffsets = remaining;
      }
      await persistMeta();
    };

    const result = await client.listOrders({
      sellerId,
      accessToken,
      since: input.range.since,
      until: input.range.until,
      deadlineMs: input.deadlineMs,
      startOffset,
      onPage: async (pageOrders) => {
        await persistOrdersOnly({
          workspaceId: connector.workspaceId,
          connectorAccountId: connector.id,
          provider: ConnectorProvider.MERCADO_LIVRE,
          orders: pageOrders,
        });
        persistedCount += pageOrders.length;
        pagesDone += 1;
        liveMeta = {
          ...liveMeta,
          isetBackfillOffsets: {
            ...readBackfillOffsets(liveMeta),
            [input.range.since]:
              startOffset + pagesDone * MERCADO_LIVRE_ORDERS_PAGE_SIZE,
          },
        };
        await persistMeta();
      },
    });

    // Window fully fetched → drop this window's resume entry (leave others).
    if (result.complete) {
      await clearResumeOffset();
    }

    // Re-derive the dailyMetric rollup from the DB (orders persisted per page).
    // Best-effort: orders are already durable and the dashboard reads
    // EcommerceOrder live.
    try {
      await recomputeEcommerceDailyMetricsFromDb({
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        provider: ConnectorProvider.MERCADO_LIVRE,
        since: input.range.since,
        until: input.range.until,
      });
    } catch (recomputeErr) {
      console.warn(
        `[ecommerce-sync] Mercado Livre dailyMetric recompute failed (connector=${connector.id}): ${recomputeErr instanceof Error ? recomputeErr.message : "unknown"}`,
      );
    }

    return { orders: [], complete: result.complete, persistedCount };
  }

  if (input.provider === ConnectorProvider.SHOPEE) {
    const shopId = Number(connector.externalAccountId);
    if (!Number.isFinite(shopId) || shopId <= 0) {
      throw new Error("Shopee shop id (externalAccountId) is invalid");
    }
    let accessToken = await connectorAccessTokenFromAccount(connector);
    const refreshToken = await connectorRefreshTokenFromAccount(connector);

    // Resolve OAuth config (workspace ProviderConfig first, env "app W3"
    // fallback). Needed for proactive token refresh AND the partner credentials
    // that sign every shop request.
    const providerConfig = await getActiveProviderConfig({
      workspaceId: connector.workspaceId,
      provider: ConnectorProvider.SHOPEE,
    });
    const config = providerConfig
      ? await buildShopeeConfigFromProviderConfig(providerConfig)
      : getGlobalShopeeConfig(process.env.NEXTAUTH_URL?.trim() ?? "");

    if (!config) {
      throw new Error(
        "Configuração da Shopee ausente. Defina SHOPEE_PARTNER_ID/SHOPEE_PARTNER_KEY ou um provider config do workspace.",
      );
    }

    // Shopee access tokens live ~4h. Refresh proactively when the stored expiry
    // is within 5 min (or already past) and we hold a refresh token, then
    // re-vault the rotated credentials (createSecret upserts by deterministic
    // name, so the same vault entries are updated in place).
    const REFRESH_SKEW_MS = 5 * 60 * 1000;
    const expiresAtMs = connector.tokenExpiresAt
      ? connector.tokenExpiresAt.getTime()
      : null;
    const needsRefresh =
      expiresAtMs !== null && expiresAtMs - Date.now() <= REFRESH_SKEW_MS;
    if (needsRefresh) {
      if (!refreshToken) {
        throw new Error(
          "Token da Shopee expirado e sem refresh token. Reconecte a integração.",
        );
      }
      const refreshClient = new ShopeeClient({ config });
      // See the Mercado Livre block: tag refresh failures so a dead grant maps
      // to TOKEN_EXPIRED while a transient blip keeps the connection ACTIVE.
      let refreshed;
      try {
        refreshed = await refreshClient.refreshAccessToken({
          refreshToken,
          shopId,
        });
      } catch (refreshErr: unknown) {
        throw new ConnectorRefreshError(
          isAuthFatalError(refreshErr),
          refreshErr,
        );
      }
      const credentialFields = await vaultCredentialFields({
        workspaceId: connector.workspaceId,
        provider: ConnectorProvider.SHOPEE,
        externalAccountId: connector.externalAccountId,
        credentials: { accessToken: refreshed.accessToken },
        refreshToken: refreshed.refreshToken ?? refreshToken,
        tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
      });
      await prisma.connectorAccount.update({
        where: { id: connector.id },
        data: { ...credentialFields, status: ConnectorStatus.ACTIVE },
      });
      accessToken = refreshed.accessToken;
    }

    const client = new ShopeeClient({ config });

    // Stream + persist per detail batch, deadline-bounded, resuming by 15-day
    // window index from the per-window offset map (same mechanism as
    // Mercado Livre/Nuvemshop/iSET).
    const shopeeMeta =
      connector.metadata &&
      typeof connector.metadata === "object" &&
      !Array.isArray(connector.metadata)
        ? (connector.metadata as Record<string, unknown>)
        : {};
    let liveMeta: Record<string, unknown> = { ...shopeeMeta };
    const persistMeta = async () => {
      await prisma.connectorAccount.update({
        where: { id: connector.id },
        data: { metadata: liveMeta as Prisma.InputJsonObject },
      });
    };
    const savedOffset = readBackfillOffsets(shopeeMeta)[input.range.since];
    const startWindowIndex = savedOffset && savedOffset >= 0 ? savedOffset : 0;
    let persistedCount = 0;

    // Drops this window's saved resume offset so the next run restarts at 0.
    const clearResumeOffset = async () => {
      const remaining = readBackfillOffsets(liveMeta);
      if (!(input.range.since in remaining)) return;
      delete remaining[input.range.since];
      liveMeta = { ...liveMeta };
      if (Object.keys(remaining).length === 0) {
        delete liveMeta.isetBackfillOffsets;
      } else {
        liveMeta.isetBackfillOffsets = remaining;
      }
      await persistMeta();
    };

    const result = await client.listOrders({
      shopId,
      accessToken,
      since: input.range.since,
      until: input.range.until,
      deadlineMs: input.deadlineMs,
      startWindowIndex,
      onPage: async (pageOrders) => {
        await persistOrdersOnly({
          workspaceId: connector.workspaceId,
          connectorAccountId: connector.id,
          provider: ConnectorProvider.SHOPEE,
          orders: pageOrders,
        });
        persistedCount += pageOrders.length;
      },
      onWindowComplete: async (nextWindowIndex) => {
        liveMeta = {
          ...liveMeta,
          isetBackfillOffsets: {
            ...readBackfillOffsets(liveMeta),
            [input.range.since]: nextWindowIndex,
          },
        };
        await persistMeta();
      },
    });

    // Window fully fetched → drop this window's resume entry (leave others).
    if (result.complete) {
      await clearResumeOffset();
    }

    // Re-derive the dailyMetric rollup from the DB (orders persisted per page).
    // Best-effort: orders are already durable and the dashboard reads
    // EcommerceOrder live.
    try {
      await recomputeEcommerceDailyMetricsFromDb({
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        provider: ConnectorProvider.SHOPEE,
        since: input.range.since,
        until: input.range.until,
      });
    } catch (recomputeErr) {
      console.warn(
        `[ecommerce-sync] Shopee dailyMetric recompute failed (connector=${connector.id}): ${recomputeErr instanceof Error ? recomputeErr.message : "unknown"}`,
      );
    }

    return { orders: [], complete: result.complete, persistedCount };
  }

  if (input.provider === ConnectorProvider.SHOPIFY) {
    const providerConfig = await getActiveProviderConfig({
      workspaceId: connector.workspaceId,
      provider: ConnectorProvider.SHOPIFY,
    });
    if (!providerConfig) {
      throw new Error("Shopify provider config is missing");
    }
    const credentials =
      await connectorCredentialsFromAccountVaultAware(connector);
    const accessToken =
      typeof credentials.accessToken === "string"
        ? credentials.accessToken
        : null;
    if (!accessToken) {
      throw new Error("Shopify access token is missing");
    }
    const config = await buildShopifyConfigFromProviderConfig(providerConfig);
    const client = new ShopifyClient({ config });
    const orders = await client.listOrders({
      shop: connector.externalAccountId,
      accessToken,
      since: input.range.since,
      until: input.range.until,
    });
    return { orders, complete: true };
  }

  if (input.provider === ConnectorProvider.ISET) {
    const isetCredentials =
      await connectorCredentialsFromAccountVaultAware(connector);
    const asText = (key: string) => {
      const value = isetCredentials[key];
      return typeof value === "string" ? value.trim() : "";
    };
    // iSET refuses to mint a new token while one is active. Reuse the token
    // persisted on the connector across syncs; the client re-auths only when
    // it is rejected (expired by inactivity).
    const metadata =
      connector.metadata &&
      typeof connector.metadata === "object" &&
      !Array.isArray(connector.metadata)
        ? (connector.metadata as Record<string, unknown>)
        : {};
    const storedToken =
      typeof metadata.isetToken === "string" ? metadata.isetToken : null;

    // Persistent auth backoff: iSET refuses a new token while one is active and
    // renews it on every request — so hammering /oauth keeps the orphan alive
    // forever. When we hit that conflict we record a DB-level backoff; until it
    // passes, ALL sync paths (cron/login/manual) skip iSET so the orphan token
    // can finally expire by inactivity (~15 min). After that, one auth succeeds
    // and the token is persisted + reused indefinitely.
    const backoffUntil =
      typeof metadata.isetAuthBackoffUntil === "string"
        ? Date.parse(metadata.isetAuthBackoffUntil)
        : 0;
    if (
      !storedToken &&
      Number.isFinite(backoffUntil) &&
      Date.now() < backoffUntil
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ecommerce-sync] iSET auth backoff active until ${new Date(backoffUntil).toISOString()} (connector=${connector.id}); skipping`,
      );
      return { orders: [], complete: true };
    }

    // Single mutable metadata accumulator: BOTH onToken (isetToken) and the
    // per-page onPage callback (backfill offset) mutate + persist it, so neither
    // clobbers the other's field — the bug we'd hit if each spread the original
    // `metadata` snapshot independently.
    let liveMeta: Record<string, unknown> = { ...metadata };
    const persistMeta = async () => {
      await prisma.connectorAccount.update({
        where: { id: connector.id },
        data: { metadata: liveMeta as Prisma.InputJsonObject },
      });
    };

    // Resume this window from where pagination stopped, looked up by `since` in
    // the per-window offset map (past months are stable, asc by orders_id, so
    // the offset stays valid across runs). A window not in the map starts at 0.
    const startOffset = Math.max(
      0,
      readBackfillOffsets(metadata)[input.range.since] ?? 0,
    );

    const client = new IsetClient({
      config: {
        baseUrl: asText("baseUrl"),
        identifier: asText("apiUser"),
        secret: asText("apiKey") || asText("apiSecret"),
      },
      initialToken: storedToken,
      // Persist the freshly-minted token immediately (before fetching orders),
      // so a mid-fetch function kill can't orphan the iSET session. Also clears
      // any stale backoff now that we hold a live token.
      onToken: async (token) => {
        liveMeta = { ...liveMeta, isetToken: token };
        delete liveMeta.isetAuthBackoffUntil;
        await persistMeta();
      },
    });

    let persistedCount = 0;
    let complete: boolean;
    try {
      const result = await client.listOrders({
        since: input.range.since,
        until: input.range.until,
        deadlineMs: input.deadlineMs,
        startOffset,
        // Persist each page as it arrives (so a mid-window kill loses at most
        // one page) and advance the resume offset. A heavy window thus builds up
        // across runs instead of restarting from page 0, and the final write
        // never has to fit a whole month into one 300s budget.
        onPage: async (pageOrders) => {
          await persistOrdersOnly({
            workspaceId: connector.workspaceId,
            connectorAccountId: connector.id,
            provider: ConnectorProvider.ISET,
            orders: pageOrders,
          });
          persistedCount += pageOrders.length;
          liveMeta = {
            ...liveMeta,
            isetBackfillOffsets: {
              ...readBackfillOffsets(liveMeta),
              [input.range.since]: startOffset + persistedCount,
            },
          };
          // Drop the legacy single-key form if a pre-deploy connector still has
          // it, so it can't shadow the map.
          delete liveMeta.isetBackfillOffset;
          delete liveMeta.isetBackfillSince;
          await persistMeta();
        },
      });
      complete = result.complete;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      if (/já tem uma sessão ativa|already been created/i.test(message)) {
        // iSET has a live session we can't use and won't replace. CLEAR the
        // stored token (it's useless) and set a 15-min backoff. With no token,
        // ALL sync paths skip iSET (see the backoff guard above) so /oauth is
        // never hit and the orphan finally expires by inactivity → self-heals.
        liveMeta = { ...liveMeta };
        delete liveMeta.isetToken;
        liveMeta.isetAuthBackoffUntil = new Date(
          Date.now() + 15 * 60 * 1000,
        ).toISOString();
        await persistMeta();
      }
      throw err;
    }

    let metaChanged = false;
    if (client.activeToken && client.activeToken !== liveMeta.isetToken) {
      // Token was adopted from the module cache (not minted via onToken).
      liveMeta = { ...liveMeta, isetToken: client.activeToken };
      metaChanged = true;
    }
    if ("isetAuthBackoffUntil" in liveMeta) {
      delete liveMeta.isetAuthBackoffUntil; // clear backoff on success
      metaChanged = true;
    }
    // Window fully fetched → drop ONLY this window's offset entry (leaving other
    // in-progress windows, e.g. a historical backfill, untouched).
    if (complete) {
      const remaining = readBackfillOffsets(liveMeta);
      const hadEntry = input.range.since in remaining;
      const hadLegacy =
        "isetBackfillOffset" in liveMeta || "isetBackfillSince" in liveMeta;
      if (hadEntry || hadLegacy) {
        delete remaining[input.range.since];
        liveMeta = { ...liveMeta };
        if (Object.keys(remaining).length === 0) {
          delete liveMeta.isetBackfillOffsets;
        } else {
          liveMeta.isetBackfillOffsets = remaining;
        }
        delete liveMeta.isetBackfillOffset;
        delete liveMeta.isetBackfillSince;
        metaChanged = true;
      }
    }
    if (metaChanged) {
      await persistMeta();
    }

    // Re-derive the ecommerce dailyMetric rollup for this window from the DB
    // (orders were persisted page-by-page, so it can't come from one in-memory
    // batch). Best-effort: orders are already durable and the dashboard reads
    // EcommerceOrder live, so a failure here (e.g. near the deadline) must not
    // fail the sync.
    try {
      await recomputeEcommerceDailyMetricsFromDb({
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        provider: ConnectorProvider.ISET,
        since: input.range.since,
        until: input.range.until,
      });
    } catch (recomputeErr) {
      console.warn(
        `[ecommerce-sync] iSET dailyMetric recompute failed (connector=${connector.id}): ${recomputeErr instanceof Error ? recomputeErr.message : "unknown"}`,
      );
    }

    return { orders: [], complete, persistedCount };
  }

  const credentials =
    await connectorCredentialsFromAccountVaultAware(connector);
  const manualClient = new ManualCommerceClient({
    provider: input.provider,
    credentials,
  });
  const payloads = await manualClient.listOrders(input.range);

  return { orders: payloads.map(normalizeManualCommerceOrder), complete: true };
}

export async function syncEcommerceOrders(input: {
  connectorAccountId: string;
  range: EcommerceSyncRange;
  syncType?: ProductionSyncType;
  /** Absolute epoch-ms wall-clock budget; honoured by iSET (see
   * loadOrdersForConnector). When the window is cut short, the returned
   * `complete` is false so the caller keeps the backfill cursor put. */
  deadlineMs?: number;
}): Promise<{ complete: boolean; ordersCount: number }> {
  const connector = await prisma.connectorAccount.findUniqueOrThrow({
    where: { id: input.connectorAccountId },
  });
  const syncJob = await prisma.syncJob.create({
    data: buildSyncJobCreateInput({
      connector,
      syncType: input.syncType ?? "BACKFILL",
      metadata: input.range,
    }),
  });

  try {
    const accessToken =
      connector.provider === ConnectorProvider.NUVEMSHOP
        ? await connectorAccessTokenFromAccount(connector)
        : undefined;
    const { orders, complete, persistedCount } = await loadOrdersForConnector({
      provider: connector.provider,
      connectorAccountId: connector.id,
      accessToken,
      range: input.range,
      deadlineMs: input.deadlineMs,
    });

    // iSET already persisted its orders page-by-page (orders is empty); other
    // providers return their orders here for a single batch persist.
    await persistEcommerceOrders({
      workspaceId: connector.workspaceId,
      connectorAccountId: connector.id,
      provider: connector.provider,
      orders,
    });

    // Best-effort: refresh per-product stock + category for providers that
    // expose a catalog API (Loja Integrada, Nuvemshop, Shopify, WBuy, Magazord,
    // Tray). A failure here must never fail the order sync — the catalog is
    // supplementary to revenue. Errors are logged (captured by Sentry) and
    // surface on the dashboard as "Sem dado"/"Sem categoria".
    if (supportsInventory(connector.provider)) {
      try {
        await syncConnectorInventory({ connectorAccountId: connector.id });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown";
        console.error(
          `[inventory-sync] ${connector.provider} ${connector.id}: ${message}`,
        );
      }
    }

    // Best-effort: visitas diárias do Mercado Livre → DailyMetric.sessions
    // (card "Visitas"). Suplementar à receita, nunca derruba o order sync.
    if (connector.provider === ConnectorProvider.MERCADO_LIVRE) {
      try {
        await syncMercadoLivreVisits({
          connectorAccountId: connector.id,
          since: input.range.since,
          until: input.range.until,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown";
        console.error(
          `[visits-sync] ${connector.provider} ${connector.id}: ${message}`,
        );
      }
    }

    const ordersCount = persistedCount ?? orders.length;

    await prisma.connectorAccount.update({
      where: { id: connector.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncError: null,
        status: ConnectorStatus.ACTIVE,
      },
    });
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: SyncStatus.SUCCESS,
        finishedAt: new Date(),
        rowsUpdated: ordersCount,
      },
    });

    return { complete, ordersCount };
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Unknown ecommerce sync error";

    // Only a dead grant (auth_fatal) downgrades the connection to TOKEN_EXPIRED.
    // Transient failures leave the status untouched (stays ACTIVE) so a network
    // blip / provider 5xx never makes the connection "drop"; the cron retries it
    // next run. Unknown errors fall back to ERROR, which the cron also retries.
    let failureKind = classifyConnectorSyncError(caught);
    // Single-use refresh-token race: if a concurrent refresh already rotated the
    // token, the invalid_grant we caught is a false alarm — keep the connection.
    if (
      failureKind === "auth_fatal" &&
      !(await grantStillDeadAfterRecheck(input.connectorAccountId))
    ) {
      failureKind = "transient";
    }
    const failureStatus = statusForSyncFailure(failureKind);

    await prisma.connectorAccount.update({
      where: { id: input.connectorAccountId },
      data: {
        ...(failureStatus ? { status: failureStatus } : {}),
        lastSyncError: message,
      },
    });
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: message,
      },
    });

    throw caught;
  }
}
