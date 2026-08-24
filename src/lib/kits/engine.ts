export type EngineGender = "feminino" | "masculino" | "unissex";
export type EngineAgeBand = "adulto" | "infantil";

export type EngineProduct = {
  id: string;
  gender: EngineGender;
  ageBand: EngineAgeBand;
  categoryKey: string;
  colorPattern?: string | null;
  externalItemId?: string | null;
  stock: number;
  price: number;
  salesVelocity?: number | null;
};

export type ComplementaryCategoryPair = {
  categoryA: string;
  categoryB: string;
  active: boolean;
};

export type KitEngineProposal = {
  componentIds: string[];
  reason: string;
  monochromatic: boolean;
  turnoverScore: number | null;
};

export type EngineInput = {
  products: EngineProduct[];
  complementaryPairs: ComplementaryCategoryPair[];
  minStock?: number;
  maxPriceRatio?: number;
};

function pairKey(categoryA: string, categoryB: string): string {
  return [categoryA, categoryB].sort().join("\u0000");
}

function hasCompatibleGender(a: EngineProduct, b: EngineProduct): boolean {
  return (
    a.gender === b.gender || a.gender === "unissex" || b.gender === "unissex"
  );
}

function turnover(products: [EngineProduct, EngineProduct]) {
  if (products.some((product) => product.salesVelocity == null)) {
    return { score: null, reason: "giro indisponivel" };
  }

  const sorted = [...products].sort((a, b) => {
    const velocity = b.salesVelocity! - a.salesVelocity!;
    return velocity || a.id.localeCompare(b.id);
  });
  return {
    score: sorted[0]!.salesVelocity! - sorted[1]!.salesVelocity!,
    reason: `giro: ${sorted[0]!.id} alta saida + ${sorted[1]!.id} giro lento`,
  };
}

function isMonochromatic(products: [EngineProduct, EngineProduct]): boolean {
  const colors = products
    .map((product) => product.colorPattern)
    .filter(Boolean);
  return colors.length === products.length && new Set(colors).size === 1;
}

export function buildProposals(input: EngineInput): KitEngineProposal[] {
  const minStock = input.minStock ?? 2;
  const maxPriceRatio = input.maxPriceRatio ?? 5;
  const approvedPairs = new Set(
    input.complementaryPairs
      .filter((pair) => pair.active)
      .map((pair) => pairKey(pair.categoryA, pair.categoryB)),
  );
  const eligible = input.products.filter(
    (product) => product.stock >= minStock,
  );
  const proposals: KitEngineProposal[] = [];

  for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < eligible.length;
      rightIndex += 1
    ) {
      const left = eligible[leftIndex]!;
      const right = eligible[rightIndex]!;
      const products: [EngineProduct, EngineProduct] = [left, right];

      if (left.ageBand !== right.ageBand || !hasCompatibleGender(left, right)) {
        continue;
      }
      if (
        left.externalItemId &&
        right.externalItemId &&
        left.externalItemId === right.externalItemId
      ) {
        continue;
      }

      const homogeneous = left.categoryKey === right.categoryKey;
      if (
        !homogeneous &&
        !approvedPairs.has(pairKey(left.categoryKey, right.categoryKey))
      ) {
        continue;
      }

      const lowestPrice = Math.min(left.price, right.price);
      const highestPrice = Math.max(left.price, right.price);
      if (lowestPrice <= 0 || highestPrice / lowestPrice > maxPriceRatio)
        continue;

      const turnoverDetails = turnover(products);
      const layer = homogeneous
        ? `homogeneo: ${left.categoryKey}`
        : `par complementar: ${[left.categoryKey, right.categoryKey].sort().join("+")}`;
      proposals.push({
        componentIds: [left.id, right.id].sort(),
        reason: `${layer}; ${turnoverDetails.reason}`,
        monochromatic: isMonochromatic(products),
        turnoverScore: turnoverDetails.score,
      });
    }
  }

  return proposals.sort((a, b) => {
    if (a.monochromatic !== b.monochromatic) return a.monochromatic ? 1 : -1;
    const scoreA = a.turnoverScore ?? Number.NEGATIVE_INFINITY;
    const scoreB = b.turnoverScore ?? Number.NEGATIVE_INFINITY;
    return (
      scoreB - scoreA ||
      a.componentIds.join(":").localeCompare(b.componentIds.join(":"))
    );
  });
}
