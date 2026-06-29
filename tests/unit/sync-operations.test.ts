import { ConnectorProvider, ConnectorStatus, SyncStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildIncrementalSyncRange,
  buildSyncJobCreateInput,
  buildSyncRunEvents,
} from "@/lib/jobs/sync-operations";

describe("sync operations", () => {
  it("uses 7 day incremental windows for ads/analytics and 3 day windows for ecommerce", () => {
    const now = new Date("2026-05-18T12:00:00.000Z");

    expect(buildIncrementalSyncRange(ConnectorProvider.META_ADS, now)).toEqual({
      since: "2026-05-11",
      until: "2026-05-18",
    });
    expect(buildIncrementalSyncRange(ConnectorProvider.GOOGLE_ADS, now)).toEqual({
      since: "2026-05-11",
      until: "2026-05-18",
    });
    expect(buildIncrementalSyncRange(ConnectorProvider.GA4, now)).toEqual({
      since: "2026-05-11",
      until: "2026-05-18",
    });
    expect(buildIncrementalSyncRange(ConnectorProvider.SHOPIFY, now)).toEqual({
      since: "2026-05-15",
      until: "2026-05-18",
    });
    expect(buildIncrementalSyncRange(ConnectorProvider.GOOGLE_SHEETS, now)).toEqual({
      since: "2026-05-15",
      until: "2026-05-18",
    });
  });

  it("builds fan-out events for active connector accounts", () => {
    expect(
      buildSyncRunEvents({
        now: new Date("2026-05-18T12:00:00.000Z"),
        connectors: [
          {
            id: "meta-1",
            provider: ConnectorProvider.META_ADS,
            status: ConnectorStatus.ACTIVE,
          },
          {
            id: "google-1",
            provider: ConnectorProvider.GOOGLE_ADS,
            status: ConnectorStatus.TOKEN_EXPIRED,
          },
          {
            id: "shopify-1",
            provider: ConnectorProvider.SHOPIFY,
            status: ConnectorStatus.ACTIVE,
          },
          {
            id: "ga4-1",
            provider: ConnectorProvider.GA4,
            status: ConnectorStatus.ACTIVE,
          },
          {
            id: "sheets-1",
            provider: ConnectorProvider.GOOGLE_SHEETS,
            status: ConnectorStatus.ACTIVE,
          },
        ],
      }),
    ).toEqual([
      {
        name: "connector.meta.backfill",
        data: {
          connectorAccountId: "meta-1",
          range: { since: "2026-05-11", until: "2026-05-18" },
          syncType: "INCREMENTAL",
        },
      },
      {
        name: "connector.shopify.backfill",
        data: {
          connectorAccountId: "shopify-1",
          range: { since: "2026-05-15", until: "2026-05-18" },
          syncType: "INCREMENTAL",
        },
      },
      {
        name: "connector.google_analytics.backfill",
        data: {
          connectorAccountId: "ga4-1",
          range: { since: "2026-05-11", until: "2026-05-18" },
          syncType: "INCREMENTAL",
        },
      },
      {
        name: "connector.ecommerce.backfill",
        data: {
          connectorAccountId: "sheets-1",
          range: { since: "2026-05-15", until: "2026-05-18" },
          syncType: "INCREMENTAL",
        },
      },
    ]);
  });

  it("creates SyncJob payloads with workspace, provider, type and cursor", () => {
    expect(
      buildSyncJobCreateInput({
        connector: {
          id: "connector-1",
          workspaceId: "workspace-1",
          provider: ConnectorProvider.NUVEMSHOP,
        },
        syncType: "INCREMENTAL",
        cursor: "page=2",
        metadata: { since: "2026-05-15", until: "2026-05-18" },
      }),
    ).toEqual({
      connectorAccountId: "connector-1",
      workspaceId: "workspace-1",
      provider: ConnectorProvider.NUVEMSHOP,
      syncType: "INCREMENTAL",
      cursor: "page=2",
      status: SyncStatus.RUNNING,
      metadata: { since: "2026-05-15", until: "2026-05-18" },
    });
  });
});
