import { callWithRetry } from "@/lib/connectors/retry";
import { resolveCategory, type InventoryRow } from "@/lib/connectors/inventory";

import { normalizeShopDomain, type ShopifyConfig } from "./oauth";

type FetchLike = typeof fetch;

type ShopifyTokenResponse = {
  access_token: string;
  scope?: string;
};

type ShopifyOrderNode = {
  id: string;
  name?: string;
  createdAt: string;
  displayFinancialStatus?: string;
  totalPriceSet?: {
    shopMoney?: {
      amount?: string;
      currencyCode?: string;
    };
  };
  customer?: {
    email?: string | null;
  } | null;
  lineItems?: {
    edges?: Array<{
      node?: {
        title?: string | null;
        sku?: string | null;
        quantity?: number;
        discountedTotalSet?: {
          shopMoney?: {
            amount?: string;
          };
        };
      };
    }>;
  };
  shippingAddress?: {
    province?: string | null;
    provinceCode?: string | null;
  } | null;
  customAttributes?: Array<{
    key?: string;
    value?: string;
  }>;
};

type ShopifyWebhookOrderPayload = {
  id?: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  created_at?: string;
  processed_at?: string;
  financial_status?: string;
  total_price?: string;
  currency?: string;
  email?: string | null;
  contact_email?: string | null;
  customer?: {
    email?: string | null;
  } | null;
  line_items?: Array<{
    title?: string | null;
    sku?: string | null;
    quantity?: number;
    price?: string;
    total_discount?: string;
  }>;
  shipping_address?: {
    province?: string | null;
    province_code?: string | null;
  } | null;
  note_attributes?: Array<{
    name?: string;
    key?: string;
    value?: string;
  }>;
  landing_site?: string | null;
  referring_site?: string | null;
};

type ShopifyOrdersResponse = {
  data?: {
    orders?: {
      edges?: Array<{
        cursor: string;
        node: ShopifyOrderNode;
      }>;
      pageInfo?: {
        hasNextPage: boolean;
        endCursor?: string | null;
      };
    };
  };
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
};

type ShopifyWebhookSubscriptionResponse = {
  data?: {
    webhookSubscriptionCreate?: {
      userErrors?: Array<{
        field?: string[];
        message?: string;
      }>;
    };
  };
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
};

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
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};

export type ShopifyOrderItem = {
  productName: string;
  sku: string | null;
  quantity: number;
  total: string | null;
};

export const SHOPIFY_WEBHOOK_TOPICS = [
  "orders/create",
  "orders/updated",
  "orders/paid",
  "app/uninstalled",
] as const;

const SHOPIFY_ORDERS_QUERY = `
query Orders($cursor: String, $query: String) {
  orders(first: 250, after: $cursor, query: $query, sortKey: CREATED_AT) {
    edges {
      cursor
      node {
        id
        name
        createdAt
        displayFinancialStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { email }
        lineItems(first: 50) {
          edges {
            node {
              title
              sku
              quantity
              discountedTotalSet { shopMoney { amount } }
            }
          }
        }
        shippingAddress { province provinceCode }
        customAttributes { key value }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

// `inventoryQuantity` needs the read_inventory scope; `productType` only needs
// read_products. We build the query with/without the inventory field so a token
// granted before read_inventory was requested can still pull categories.
function shopifyProductsQuery(includeInventory: boolean) {
  const variantFields = includeInventory
    ? "sku inventoryQuantity inventoryItem { tracked }"
    : "sku";
  return `
query Products($cursor: String) {
  products(first: 250, after: $cursor, sortKey: TITLE) {
    edges {
      cursor
      node {
        id
        title
        productType
        variants(first: 100) { edges { node { ${variantFields} } } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;
}

type ShopifyProductNode = {
  id: string;
  title?: string | null;
  productType?: string | null;
  variants?: {
    edges?: Array<{
      node?: {
        sku?: string | null;
        inventoryQuantity?: number | null;
        // tracked === false → Shopify isn't managing stock for this variant
        // (unlimited / always sellable).
        inventoryItem?: { tracked?: boolean | null } | null;
      };
    }>;
  };
};

type ShopifyProductsResponse = {
  data?: {
    products?: {
      edges?: Array<{ cursor: string; node: ShopifyProductNode }>;
      pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
    };
  };
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
};

function isAccessDeniedError(
  errors: ShopifyProductsResponse["errors"],
): boolean {
  return Boolean(
    errors?.some((error) => {
      const code = (error.extensions as { code?: string } | undefined)?.code;
      return (
        code === "ACCESS_DENIED" ||
        /access denied|read_inventory|scope/i.test(error.message)
      );
    }),
  );
}

function normalizeShopifyProduct(
  node: ShopifyProductNode,
): InventoryRow | null {
  const externalProductId = node.id;
  const productName = node.title?.trim();
  if (!externalProductId || !productName) {
    return null;
  }
  const variants = (node.variants?.edges ?? [])
    .map((edge) => edge.node)
    .filter((variant): variant is NonNullable<typeof variant> =>
      Boolean(variant),
    );
  // Only sum variants Shopify actually tracks. A variant with
  // inventoryItem.tracked === false is unlimited; if NONE are tracked the
  // product is "available/unlimited" → quantity null ("Disponível"), not 0.
  // ponytail: when the token lacks read_inventory the retry path drops the
  // inventory fields, so tracked is undefined and the product reads as a
  // tracked 0 (a "real" out-of-stock) rather than "unknown". Both prod Shopify
  // tokens carry read_inventory, so this can't fire today; the upgrade — if a
  // scope-less token ever ships — is a distinct "unknown" stock state.
  let trackedSum = 0;
  let hasTracked = false;
  for (const variant of variants) {
    if (variant.inventoryItem?.tracked === false) {
      continue;
    }
    hasTracked = true;
    const raw = Number(variant.inventoryQuantity);
    trackedSum += Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
  }
  const quantity = hasTracked ? trackedSum : null;
  const sku =
    variants.map((variant) => variant.sku).find((value) => Boolean(value)) ??
    null;
  return {
    externalProductId,
    sku: sku ? String(sku).trim() : null,
    productName,
    categoryName: resolveCategory(node.productType),
    quantity,
  };
}

const SHOPIFY_WEBHOOK_SUBSCRIPTION_CREATE_MUTATION = `
mutation WebhookSubscriptionCreate(
  $topic: WebhookSubscriptionTopic!,
  $webhookSubscription: WebhookSubscriptionInput!
) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id }
    userErrors { field message }
  }
}
`;

const SHOPIFY_GRAPHQL_WEBHOOK_TOPICS: Record<
  (typeof SHOPIFY_WEBHOOK_TOPICS)[number],
  string
> = {
  "orders/create": "ORDERS_CREATE",
  "orders/updated": "ORDERS_UPDATED",
  "orders/paid": "ORDERS_PAID",
  "app/uninstalled": "APP_UNINSTALLED",
};

export class ShopifyApiError extends Error {
  status: number;
  body: string;
  response: {
    status: number;
    headers: Headers;
  };

  constructor(status: number, body: string, headers = new Headers()) {
    super(`Shopify API request failed with status ${status}`);
    this.name = "ShopifyApiError";
    this.status = status;
    this.body = body;
    this.response = { status, headers };
  }
}

async function fetchJson<T>(
  url: URL | string,
  fetchImpl: FetchLike,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, init);
  const body = await response.text();

  if (!response.ok) {
    throw new ShopifyApiError(response.status, body, response.headers);
  }

  return JSON.parse(body) as T;
}

function parseUtmFromValue(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    const url = new URL(value, "https://shop.myshopify.com");

    return {
      utmSource: url.searchParams.get("utm_source"),
      utmMedium: url.searchParams.get("utm_medium"),
      utmCampaign: url.searchParams.get("utm_campaign"),
    };
  } catch {
    return {};
  }
}

function customAttributeValue(
  attributes: ShopifyWebhookOrderPayload["note_attributes"],
  key: string,
) {
  return (
    attributes?.find((attribute) => (attribute.key ?? attribute.name) === key)
      ?.value ?? null
  );
}

export function normalizeShopifyOrder(node: ShopifyOrderNode): ShopifyOrder {
  const customAttributes = new Map(
    (node.customAttributes ?? []).map((attribute) => [
      attribute.key,
      attribute.value,
    ]),
  );
  const itemsCount =
    node.lineItems?.edges?.reduce(
      (sum, edge) => sum + (edge.node?.quantity ?? 0),
      0,
    ) ?? 0;
  const items =
    node.lineItems?.edges
      ?.map((edge) => edge.node)
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item, index) => ({
        productName: item.title ?? `Produto ${index + 1}`,
        sku: item.sku ?? null,
        quantity: item.quantity ?? 1,
        total: item.discountedTotalSet?.shopMoney?.amount ?? null,
      })) ?? [];

  return {
    externalOrderId: node.id,
    orderNumber: node.name ?? null,
    orderTotal: node.totalPriceSet?.shopMoney?.amount ?? "0",
    orderCurrency: node.totalPriceSet?.shopMoney?.currencyCode ?? "BRL",
    customerEmail: node.customer?.email ?? null,
    itemsCount,
    items,
    status: node.displayFinancialStatus ?? "UNKNOWN",
    shippingState:
      node.shippingAddress?.provinceCode ??
      node.shippingAddress?.province ??
      null,
    placedAt: node.createdAt,
    utmSource: customAttributes.get("utm_source") ?? null,
    utmMedium: customAttributes.get("utm_medium") ?? null,
    utmCampaign: customAttributes.get("utm_campaign") ?? null,
  };
}

export function normalizeShopifyWebhookOrder(
  payload: ShopifyWebhookOrderPayload,
): ShopifyOrder {
  const utmFromLandingSite = parseUtmFromValue(payload.landing_site);
  const id =
    payload.admin_graphql_api_id ?? `gid://shopify/Order/${payload.id ?? ""}`;

  return {
    externalOrderId: id,
    orderNumber: payload.name ?? null,
    orderTotal: payload.total_price ?? "0",
    orderCurrency: payload.currency ?? "BRL",
    customerEmail:
      payload.email ?? payload.contact_email ?? payload.customer?.email ?? null,
    itemsCount:
      payload.line_items?.reduce(
        (sum, lineItem) => sum + (lineItem.quantity ?? 0),
        0,
      ) ?? 0,
    items:
      payload.line_items?.map((lineItem, index) => ({
        productName: lineItem.title ?? `Produto ${index + 1}`,
        sku: lineItem.sku ?? null,
        quantity: lineItem.quantity ?? 1,
        total: lineItem.price ?? null,
      })) ?? [],
    status: payload.financial_status?.toUpperCase() ?? "UNKNOWN",
    shippingState:
      payload.shipping_address?.province_code ??
      payload.shipping_address?.province ??
      null,
    placedAt:
      payload.processed_at ?? payload.created_at ?? new Date().toISOString(),
    utmSource:
      customAttributeValue(payload.note_attributes, "utm_source") ??
      utmFromLandingSite.utmSource,
    utmMedium:
      customAttributeValue(payload.note_attributes, "utm_medium") ??
      utmFromLandingSite.utmMedium,
    utmCampaign:
      customAttributeValue(payload.note_attributes, "utm_campaign") ??
      utmFromLandingSite.utmCampaign,
  };
}

export function buildShopifyWebhookAddress(input: { redirectUri: string }) {
  return new URL("/api/webhooks/shopify", input.redirectUri).toString();
}

function shouldIgnoreWebhookCreateError(error: unknown) {
  return (
    error instanceof ShopifyApiError &&
    error.status === 422 &&
    /already|taken|address/i.test(error.body)
  );
}

function shouldIgnoreWebhookUserError(message: string | undefined) {
  return Boolean(message && /already|taken|address/i.test(message));
}

export class ShopifyClient {
  private readonly config: ShopifyConfig;
  private readonly fetchImpl: FetchLike;

  constructor(input: { config: ShopifyConfig; fetchImpl?: FetchLike }) {
    this.config = input.config;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async exchangeCodeForAccessToken(input: { shop: string; code: string }) {
    const shop = normalizeShopDomain(input.shop);
    const body = new URLSearchParams({
      client_id: this.config.apiKey,
      client_secret: this.config.apiSecret,
      code: input.code,
    });

    return callWithRetry(() =>
      fetchJson<ShopifyTokenResponse>(
        `https://${shop}/admin/oauth/access_token`,
        this.fetchImpl,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        },
      ),
    );
  }

  async listOrders(input: {
    shop: string;
    accessToken: string;
    since: string;
    until: string;
  }) {
    const shop = normalizeShopDomain(input.shop);
    const orders: ShopifyOrder[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;
    const query = `created_at:>=${input.since} created_at:<=${input.until}`;

    while (hasNextPage) {
      const response = await callWithRetry(() =>
        fetchJson<ShopifyOrdersResponse>(
          `https://${shop}/admin/api/${this.config.apiVersion}/graphql.json`,
          this.fetchImpl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": input.accessToken,
            },
            body: JSON.stringify({
              query: SHOPIFY_ORDERS_QUERY,
              variables: { cursor, query },
            }),
          },
        ),
      );

      if (response.errors) {
        const summary = response.errors
          .map((e) => {
            const code =
              (e.extensions as { code?: string } | undefined)?.code ?? "";
            return code ? `${e.message} [${code}]` : e.message;
          })
          .filter(Boolean)
          .join(" | ");
        throw new Error(`Shopify GraphQL error: ${summary}`);
      }

      const connection = response.data?.orders;
      orders.push(
        ...(connection?.edges ?? []).map((edge) =>
          normalizeShopifyOrder(edge.node),
        ),
      );
      hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
      cursor = connection?.pageInfo?.endCursor ?? null;
    }

    return orders;
  }

  /**
   * Current catalog (stock + category per product). Paginates the products
   * connection by cursor. Tries with inventoryQuantity first; if the token
   * lacks read_inventory, retries category-only so the Categorias widget still
   * gets data (stock then degrades to "Sem dado").
   */
  async listProducts(input: {
    shop: string;
    accessToken: string;
  }): Promise<InventoryRow[]> {
    const shop = normalizeShopDomain(input.shop);
    const endpoint = `https://${shop}/admin/api/${this.config.apiVersion}/graphql.json`;
    const rows: InventoryRow[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;
    let includeInventory = true;
    const MAX_PAGES = 1000; // safety cap: 1000 * 250 = 250k products.

    for (let page = 0; page < MAX_PAGES && hasNextPage; page += 1) {
      const response: ShopifyProductsResponse = await callWithRetry(() =>
        fetchJson<ShopifyProductsResponse>(endpoint, this.fetchImpl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": input.accessToken,
          },
          body: JSON.stringify({
            query: shopifyProductsQuery(includeInventory),
            variables: { cursor },
          }),
        }),
      );

      if (response.errors) {
        // Token without read_inventory: drop the inventory field and retry the
        // same page once (category-only). Reset pagination so we don't skip.
        if (includeInventory && isAccessDeniedError(response.errors)) {
          includeInventory = false;
          cursor = null;
          hasNextPage = true;
          rows.length = 0;
          continue;
        }
        const summary = response.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" | ");
        throw new Error(`Shopify GraphQL error: ${summary}`);
      }

      const connection = response.data?.products;
      for (const edge of connection?.edges ?? []) {
        const row = normalizeShopifyProduct(edge.node);
        if (row) {
          rows.push(row);
        }
      }
      hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
      cursor = connection?.pageInfo?.endCursor ?? null;
    }

    return rows;
  }

  async ensureWebhookSubscriptions(input: {
    shop: string;
    accessToken: string;
  }) {
    const shop = normalizeShopDomain(input.shop);
    const address = buildShopifyWebhookAddress({
      redirectUri: this.config.redirectUri,
    });

    for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
      try {
        const response = await callWithRetry(() =>
          fetchJson<ShopifyWebhookSubscriptionResponse>(
            `https://${shop}/admin/api/${this.config.apiVersion}/graphql.json`,
            this.fetchImpl,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": input.accessToken,
              },
              body: JSON.stringify({
                query: SHOPIFY_WEBHOOK_SUBSCRIPTION_CREATE_MUTATION,
                variables: {
                  topic: SHOPIFY_GRAPHQL_WEBHOOK_TOPICS[topic],
                  webhookSubscription: {
                    callbackUrl: address,
                    format: "JSON",
                  },
                },
              }),
            },
          ),
        );

        if (response.errors) {
          throw new Error("Shopify GraphQL webhook creation returned errors");
        }

        const userErrors =
          response.data?.webhookSubscriptionCreate?.userErrors ?? [];
        const unexpectedErrors = userErrors.filter(
          (userError) => !shouldIgnoreWebhookUserError(userError.message),
        );
        if (unexpectedErrors.length > 0) {
          throw new Error(
            unexpectedErrors.map((error) => error.message).join("; "),
          );
        }
      } catch (error) {
        if (!shouldIgnoreWebhookCreateError(error)) {
          throw error;
        }
      }
    }
  }
}
