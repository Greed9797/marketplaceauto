import { syncGoogleAdsBackfill } from "./sync-google-ads";
import { syncGoogleAnalyticsBackfill } from "./sync-google-analytics";
import { syncEcommerceBackfill } from "./sync-ecommerce";
import { syncMetaBackfill } from "./sync-meta";
import { syncShopifyBackfill } from "./sync-shopify";
import { syncActiveConnectorsDaily } from "./sync-daily";

export const inngestFunctions = [
  syncActiveConnectorsDaily,
  syncMetaBackfill,
  syncGoogleAdsBackfill,
  syncGoogleAnalyticsBackfill,
  syncShopifyBackfill,
  syncEcommerceBackfill,
];
