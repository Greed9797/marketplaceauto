/**
 * Runway de estoque (STCK-02): quantos dias restam dado o ritmo de vendas.
 * Janela padrão de 14 dias de pedidos sincronizados.
 */

export const RUNWAY_WINDOW_DAYS = 14;

/** Média de unidades vendidas por dia na janela. */
export function averageUnitsPerDay(
  totalUnits: number,
  days: number = RUNWAY_WINDOW_DAYS,
): number | null {
  if (!(days > 0)) return null;
  return totalUnits / days;
}

/**
 * Dias restantes de estoque, arredondados para cima. Retorna null quando a
 * média é zero/indisponível — o alerta de estoque segue sem runway (STCK-04).
 * Estoque 0 com vendas ativas retorna 0: é o caso mais urgente possível.
 */
export function computeRunwayDays(
  stock: number,
  unitsPerDay: number | null | undefined,
): number | null {
  if (unitsPerDay == null || !(unitsPerDay > 0)) return null;
  return Math.ceil(stock / unitsPerDay);
}
