/** One product's current on-hand stock + category, normalized across store APIs. */
export type InventoryRow = {
  externalProductId: string;
  sku: string | null;
  productName: string;
  /** Category name when the catalog API exposes it; null otherwise. */
  categoryName: string | null;
  /**
   * Tracked on-hand count, or null when the store does not track stock for the
   * product (sells unlimited / always available → rendered as "Disponível").
   */
  quantity: number | null;
};

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

/**
 * Pull a display string out of a heterogeneous category field. Store APIs shape
 * categories every which way: a flat string, an i18n map ({ pt: "..." }), an
 * object with a name field, or a list of those. We probe the common shapes and
 * return the first usable name. A bare numeric/URI id is NOT a usable name, so
 * it is ignored (the dashboard needs a label, not an id).
 */
export function resolveCategory(...values: unknown[]): string | null {
  for (const value of values) {
    const resolved = resolveCategoryValue(value);
    if (resolved) return resolved;
  }
  return null;
}

function resolveCategoryValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Reject resource URIs / pure-id strings (e.g. "/api/v1/categoria/12/").
    if (!trimmed || trimmed.startsWith("/") || /^\d+$/.test(trimmed)) {
      return null;
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = resolveCategoryValue(item);
      if (resolved) return resolved;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Object with an explicit name field (incl. i18n maps under name).
    const named = firstString(
      obj.nome,
      obj.name,
      obj.titulo,
      obj.title,
      obj.descricao,
      obj.description,
    );
    if (named && !/^\d+$/.test(named)) return named;
    // i18n map: { pt: "...", es: "...", en: "..." } (Nuvemshop-style).
    const i18n = firstString(obj.pt, obj.pt_BR, obj.es, obj.en);
    if (i18n) return i18n;
    // One level into common nested wrappers, e.g. Tray's
    // { ProductCategory: { Category: { name } } } or { categoria: {...} }.
    for (const key of ["Category", "categoria", "category", "node", "value"]) {
      if (key in obj) {
        const nested = resolveCategoryValue(obj[key]);
        if (nested) return nested;
      }
    }
  }
  return null;
}

/**
 * Resolve an integer stock quantity from a heterogeneous payload. Loja
 * Integrada exposes on-hand stock under different shapes depending on store
 * config (a flat number, a nested `estoque.quantidade`, a `gerenciar_estoque`
 * object, etc.), so we probe the common keys and coerce to a non-negative int.
 * ponytail: covers the documented LI shapes; if a store gates stock behind the
 * separate /produto_estoque/ resource this returns 0 — add that fetch as the
 * upgrade path rather than guessing more keys here.
 */
function resolveQuantity(payload: Record<string, unknown>): number {
  const direct =
    payload.quantidade ??
    payload.quantidade_estoque ??
    payload.estoque_quantidade ??
    payload.quantidade_em_estoque ??
    payload.saldo ??
    payload.stock ??
    payload.inventory_quantity;
  // WBuy exposes stock per variation under `estoque: [{ quantidade_em_estoque }]`.
  // Sum the variations so the product's on-hand count reflects all of them.
  const fromArray = (() => {
    if (!Array.isArray(payload.estoque)) return null;
    let sum = 0;
    let found = false;
    for (const entry of payload.estoque) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const value =
        obj.quantidade_em_estoque ?? obj.quantidade ?? obj.saldo ?? obj.stock;
      const num =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number.parseFloat(value.replace(/[^\d.-]/g, ""))
            : NaN;
      if (Number.isFinite(num)) {
        sum += Math.max(0, Math.trunc(num));
        found = true;
      }
    }
    return found ? sum : null;
  })();
  const fromNested = (() => {
    const nested = payload.estoque ?? payload.gerenciar_estoque;
    if (typeof nested === "number") return nested;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const obj = nested as Record<string, unknown>;
      return obj.quantidade ?? obj.saldo ?? obj.disponivel ?? null;
    }
    return null;
  })();

  const raw = direct ?? fromArray ?? fromNested;
  const num =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw.replace(/[^\d.-]/g, ""))
        : NaN;
  return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0;
}

/**
 * Store catalog product object → InventoryRow. Tolerant to the field naming of
 * Loja Integrada (/produto/search/) and the other manual commerce providers
 * (WBuy, iSET, Magazord, Tray), which all expose a product list with stock,
 * sku and category under different keys. Returns null when the product has no
 * usable id+name (can't be matched/keyed). Category is best-effort — a provider
 * that only exposes category ids/URIs (not names) yields null and the dashboard
 * degrades to "Sem categoria" for it.
 * ponytail: one tolerant normalizer over per-provider duplicates; if a provider
 * needs a dedicated shape, branch in manual-commerce-client, not here.
 */
export function normalizeManualInventory(
  payload: Record<string, unknown>,
): InventoryRow | null {
  const externalProductId = firstString(
    payload.id,
    payload.id_produto,
    payload.produto_id,
    payload.codigo,
    payload.sku,
  );
  const productName = firstString(
    payload.nome,
    // WBuy names the product field `produto` (not `nome`); without this the
    // whole WBuy catalog was rejected here and synced zero inventory rows.
    payload.produto,
    payload.nome_produto,
    payload.name,
    payload.titulo,
    payload.title,
  );
  if (!externalProductId || !productName) {
    return null;
  }
  return {
    externalProductId,
    sku: firstString(
      payload.sku,
      payload.cod,
      payload.codigo,
      payload.referencia,
      payload.reference,
      payload.ean,
    ),
    productName,
    categoryName: resolveCategory(
      // WBuy nests category names under categoria_level1/2/3.{nome}; prefer the
      // top-level category for the dashboard's "Categorias" grouping.
      payload.categoria_level1,
      payload.categoria_level2,
      payload.categoria_level3,
      payload.categoria,
      payload.categorias,
      payload.category,
      payload.categories,
      payload.categoria_nome,
      payload.category_name,
      payload.departamento,
      payload.department,
      payload.product_category,
      payload.ProductCategory,
    ),
    quantity: resolveQuantity(payload),
  };
}

/**
 * Back-compat alias: the normalizer is generic, but Loja Integrada was the
 * first (and originally only) caller. Kept so existing imports/tests resolve.
 */
export const normalizeLojaIntegradaInventory = normalizeManualInventory;
