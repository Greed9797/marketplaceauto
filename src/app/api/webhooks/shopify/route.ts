import { ConnectorProvider, ConnectorStatus, Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { logAudit } from "@/lib/audit/log";
import { ecommerceDailyDedupeHash } from "@/lib/connectors/ecommerce-sync";
import {
  buildShopifyConfigFromProviderConfig,
  getActiveProviderConfig,
} from "@/lib/connectors/provider-config";
import { normalizeShopifyWebhookOrder } from "@/lib/connectors/shopify/client";
import {
  normalizeShopDomain,
  verifyShopifyWebhookHmac,
} from "@/lib/connectors/shopify/oauth";
import { mapShopifyOrderToEcommerceOrder } from "@/lib/connectors/shopify/sync";
import { prisma } from "@/lib/db/prisma";
import { isApprovedOrderStatus } from "@/lib/metrics/order-status";

export const runtime = "nodejs";

const orderTopics = new Set(["orders/create", "orders/updated", "orders/paid"]);

function dayBounds(date: Date) {
  const day = date.toISOString().slice(0, 10);

  return {
    day,
    start: new Date(`${day}T00:00:00.000Z`),
    end: new Date(`${day}T23:59:59.999Z`),
  };
}

async function refreshShopifyDailyMetric(input: {
  workspaceId: string;
  connectorAccountId: string;
  placedAt: Date;
}) {
  const bounds = dayBounds(input.placedAt);

  // Re-aggregate only orders with approved financial status. Reading the rows
  // is mandatory (status enum lives on the row, not on a column we could
  // aggregate directly), but we keep the projection narrow.
  const dayOrders = await prisma.ecommerceOrder.findMany({
    where: {
      connectorAccountId: input.connectorAccountId,
      placedAt: { gte: bounds.start, lte: bounds.end },
    },
    select: { orderTotal: true, status: true },
  });

  const approved = dayOrders.filter((row) => isApprovedOrderStatus(row.status));
  const revenue = approved
    .reduce(
      (sum, row) => sum.plus(new Prisma.Decimal(row.orderTotal ?? 0)),
      new Prisma.Decimal(0),
    )
    .toFixed(2);
  const orders = BigInt(approved.length);

  const dedupeHash = ecommerceDailyDedupeHash({
    workspaceId: input.workspaceId,
    connectorAccountId: input.connectorAccountId,
    provider: ConnectorProvider.SHOPIFY,
    date: bounds.day,
  });

  await prisma.dailyMetric.upsert({
    where: { dedupeHash },
    update: { revenue, orders },
    create: {
      workspaceId: input.workspaceId,
      connectorAccountId: input.connectorAccountId,
      date: bounds.start,
      source: ConnectorProvider.SHOPIFY,
      revenue,
      orders,
      dedupeHash,
    },
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic");
  const shopHeader = request.headers.get("x-shopify-shop-domain");

  if (!shopHeader) {
    return NextResponse.json(
      { error: "Missing Shopify shop domain" },
      { status: 400 },
    );
  }
  const shop = normalizeShopDomain(shopHeader);
  const candidateConnectors = await prisma.connectorAccount.findMany({
    where: {
      provider: ConnectorProvider.SHOPIFY,
      externalAccountId: shop,
      status: ConnectorStatus.ACTIVE,
    },
  });

  if (candidateConnectors.length === 0) {
    // Uniform 401 — identical to a bad-signature response below — so an
    // unauthenticated caller can't enumerate which shop domains are registered
    // by distinguishing 503 (unknown shop) from 401 (known shop, bad HMAC).
    return NextResponse.json(
      { error: "Invalid Shopify webhook signature" },
      { status: 401 },
    );
  }

  const verifiedConnectors = [];
  for (const connector of candidateConnectors) {
    const providerConfig = await getActiveProviderConfig({
      workspaceId: connector.workspaceId,
      provider: ConnectorProvider.SHOPIFY,
    });
    if (!providerConfig) {
      continue;
    }

    const config = await buildShopifyConfigFromProviderConfig(providerConfig);
    if (verifyShopifyWebhookHmac(rawBody, hmac, config.apiSecret)) {
      verifiedConnectors.push(connector);
    }
  }

  if (verifiedConnectors.length === 0) {
    return NextResponse.json(
      { error: "Invalid Shopify webhook signature" },
      { status: 401 },
    );
  }

  // Two workspaces sharing the same `apiSecret` for the same shop would let
  // one workspace's webhook leak into the other. Treat that as a config error
  // and refuse to fan out — operator must rotate one of the secrets.
  if (verifiedConnectors.length > 1) {
    console.error(
      `[shopify-webhook] ambiguous shop=${shop} matched ${verifiedConnectors.length} connectors; refusing fan-out`,
    );
    return NextResponse.json(
      { error: "Ambiguous Shopify connector — secret collision" },
      { status: 409 },
    );
  }

  if (topic === "app/uninstalled") {
    // Scope to the workspace whose secret verified the HMAC. The same shop
    // domain can be connected in more than one workspace; an uninstall from one
    // must not revoke the others' connectors.
    await prisma.connectorAccount.updateMany({
      where: {
        workspaceId: verifiedConnectors[0].workspaceId,
        provider: ConnectorProvider.SHOPIFY,
        externalAccountId: shop,
      },
      data: {
        status: ConnectorStatus.REVOKED,
        lastSyncError: "Shopify app uninstalled",
      },
    });

    await logAudit({
      action: "connector.shopify.uninstall",
      resourceType: "connector_account",
      resourceId: shop,
      metadata: {
        provider: "SHOPIFY",
        topic,
      },
    });
  }

  if (topic && orderTopics.has(topic)) {
    const order = normalizeShopifyWebhookOrder(
      JSON.parse(rawBody) as Parameters<typeof normalizeShopifyWebhookOrder>[0],
    );

    for (const connector of verifiedConnectors) {
      const payload = mapShopifyOrderToEcommerceOrder({
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        order,
      });

      await prisma.ecommerceOrder.upsert({
        where: {
          connectorAccountId_externalOrderId: {
            connectorAccountId: connector.id,
            externalOrderId: order.externalOrderId,
          },
        },
        update: payload,
        create: payload,
      });
      await refreshShopifyDailyMetric({
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        placedAt: payload.placedAt,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
