import { syncGoogleAdsBackfill } from "./sync-google-ads";
import { syncGoogleAnalyticsBackfill } from "./sync-google-analytics";
import { syncEcommerceBackfill } from "./sync-ecommerce";
import { syncMetaBackfill } from "./sync-meta";
import { syncShopifyBackfill } from "./sync-shopify";
import { checkDemandSla } from "./check-demand-sla";

export const inngestFunctions = [
  checkDemandSla,
  syncMetaBackfill,
  syncGoogleAdsBackfill,
  syncGoogleAnalyticsBackfill,
  syncShopifyBackfill,
  syncEcommerceBackfill,
];
