/**
 * Janelas de comparação de ROAS com compensação de atribuição (ROAS-05).
 *
 * Shopee fecha conversões (boleto/Pix) em até 48–72h. Comparar "últimos 3
 * dias" incluindo hoje produz falsas quedas porque o período recente ainda
 * está em aberto. Todas as janelas terminam em `now - lag`, nunca em `now`.
 */

export const ATTRIBUTION_LAG_HOURS = 72;
export const RECENT_WINDOW_DAYS = 3;
export const BASELINE_WINDOW_DAYS = 7;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type RoasWindows = {
  /** now - lag: nenhuma métrica posterior a este instante entra no cálculo. */
  cutoff: Date;
  /** Início da janela recente (cutoff - RECENT_WINDOW_DAYS). */
  recentStart: Date;
  /** Fim (exclusivo) da janela recente — é o próprio cutoff. */
  recentEnd: Date;
  /** Início da janela baseline (recentStart - BASELINE_WINDOW_DAYS). */
  baselineStart: Date;
  /** Fim (exclusivo) da janela baseline — contígua à recente. */
  baselineEnd: Date;
};

export function computeLaggedWindows(
  now: Date,
  lagHours: number = ATTRIBUTION_LAG_HOURS,
): RoasWindows {
  const cutoff = new Date(now.getTime() - lagHours * HOUR_MS);
  const recentStart = new Date(cutoff.getTime() - RECENT_WINDOW_DAYS * DAY_MS);
  const baselineStart = new Date(
    recentStart.getTime() - BASELINE_WINDOW_DAYS * DAY_MS,
  );

  return {
    cutoff,
    recentStart,
    recentEnd: cutoff,
    baselineStart,
    baselineEnd: recentStart,
  };
}

/**
 * Razão ROAS recente / baseline. Baseline ausente ou não positivo devolve 1 —
 * a regra só alerta quando existe baseline confiável para comparar.
 */
export function roasRatio(baselineRoas: number, recentRoas: number): number {
  if (!(baselineRoas > 0)) return 1;
  return recentRoas / baselineRoas;
}
