import { ConnectorProvider } from "@prisma/client";
import { describe, expect, test } from "vitest";

import { SYNC_HELPERS } from "@/lib/connectors/sync-helpers";
import { isSyncableProvider } from "@/lib/jobs/sync-operations";

// Regression: MERCADO_LIVRE/SHOPEE were missing from both maps, so no
// recurring path (workspace cron, daily Inngest cron, manual sync) ever
// re-synced marketplace orders after the initial OAuth backfill.
describe("marketplace providers are wired into recurring sync", () => {
  test.each([ConnectorProvider.MERCADO_LIVRE, ConnectorProvider.SHOPEE])(
    "%s has a sync helper and is daily-syncable",
    (provider) => {
      expect(SYNC_HELPERS[provider]).toBeTypeOf("function");
      expect(isSyncableProvider(provider)).toBe(true);
    },
  );
});
