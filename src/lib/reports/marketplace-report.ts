import { prisma } from "@/lib/db/prisma";
import { isApprovedOrderStatus } from "@/lib/metrics/order-status";

/**
 * Consolidated marketplace report for the WhatsApp-style daily message.
 *
 * "Comissão" = per-Cliente `comissaoPercent` applied to that client's approved
 * GMV. "Faturamento" = approved GMV (paid orders only, via `isApprovedOrderStatus`).
 * Clientes novos / churn are filled in by hand in the UI, so they are NOT here.
 *
 * ponytail: fixed America/Sao_Paulo offset (-03:00). Brazil has had no DST since
 * 2019 — revisit only if it returns.
 */

const SAO_PAULO_OFFSET = "-03:00";

export type MarketplaceReport = {
  /** Reference date the report is issued for, as `YYYY-MM-DD` (São Paulo). */
  referenceDate: string;
  /** `DD/MM` label for the YTD line. */
  referenceLabel: string;
  faturamentoDiaAnterior: number;
  comissaoDiaAnterior: number;
  /** Pre-filled suggestion; the operator may override it in the UI. */
  clientesNovosDiaAnterior: number;
  clientesTotais: number;
  comissaoAcumuladaYtd: number;
};

type OrderRow = {
  orderTotal: unknown;
  status: string;
  platform: string;
  connectorAccount: { clienteId: string | null };
};

/** Start (inclusive) and end (exclusive) of a São Paulo local day in UTC. */
export function saoPauloDayRange(date: string): { gte: Date; lt: Date } {
  const gte = new Date(`${date}T00:00:00${SAO_PAULO_OFFSET}`);
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}

/** `YYYY-MM-DD` of the São Paulo local day `days` before the given date. */
export function shiftDate(date: string, days: number): string {
  const base = new Date(`${date}T12:00:00${SAO_PAULO_OFFSET}`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Today's date (`YYYY-MM-DD`) in São Paulo. */
export function saoPauloToday(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now); // en-CA → YYYY-MM-DD
}

function labelDDMM(date: string): string {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}

/**
 * Sums approved GMV and agency commission over a set of orders. Commission for
 * an order = orderTotal × (its client's comissaoPercent / 100). Orders with no
 * client or a null percent contribute to GMV but zero commission.
 */
function sumFaturamentoEComissao(
  orders: ReadonlyArray<OrderRow>,
  comissaoByCliente: ReadonlyMap<string, number>,
): { faturamento: number; comissao: number } {
  let faturamento = 0;
  let comissao = 0;
  for (const order of orders) {
    if (!isApprovedOrderStatus(order.status, order.platform)) continue;
    const total = Number(order.orderTotal);
    if (!Number.isFinite(total)) continue;
    faturamento += total;
    const clienteId = order.connectorAccount.clienteId;
    const percent = clienteId ? (comissaoByCliente.get(clienteId) ?? 0) : 0;
    comissao += total * (percent / 100);
  }
  return { faturamento, comissao };
}

async function loadOrders(
  workspaceId: string,
  range: { gte: Date; lt: Date },
): Promise<OrderRow[]> {
  return prisma.ecommerceOrder.findMany({
    where: { workspaceId, placedAt: { gte: range.gte, lt: range.lt } },
    select: {
      orderTotal: true,
      status: true,
      platform: true,
      connectorAccount: { select: { clienteId: true } },
    },
  });
}

/**
 * Computes the consolidated report for `workspaceId` as of `referenceDate`
 * (`YYYY-MM-DD`, São Paulo). "Dia anterior" is the day before it; YTD spans
 * Jan 1 of that year through the end of `referenceDate` (inclusive).
 */
export async function computeMarketplaceReport(input: {
  workspaceId: string;
  referenceDate: string;
}): Promise<MarketplaceReport> {
  const { workspaceId, referenceDate } = input;
  const prevDate = shiftDate(referenceDate, -1);
  const prevRange = saoPauloDayRange(prevDate);
  const yearStart = new Date(
    `${referenceDate.slice(0, 4)}-01-01T00:00:00${SAO_PAULO_OFFSET}`,
  );
  const ytdRange = { gte: yearStart, lt: saoPauloDayRange(referenceDate).lt };

  const [clientes, prevOrders, ytdOrders] = await Promise.all([
    prisma.cliente.findMany({
      where: { workspaceId },
      select: { id: true, comissaoPercent: true, ativo: true, createdAt: true },
    }),
    loadOrders(workspaceId, prevRange),
    loadOrders(workspaceId, ytdRange),
  ]);

  const comissaoByCliente = new Map<string, number>();
  let clientesTotais = 0;
  let clientesNovosDiaAnterior = 0;
  for (const cliente of clientes) {
    if (cliente.comissaoPercent !== null) {
      comissaoByCliente.set(cliente.id, Number(cliente.comissaoPercent));
    }
    if (cliente.ativo) clientesTotais += 1;
    if (
      cliente.createdAt >= prevRange.gte &&
      cliente.createdAt < prevRange.lt
    ) {
      clientesNovosDiaAnterior += 1;
    }
  }

  const prev = sumFaturamentoEComissao(prevOrders, comissaoByCliente);
  const ytd = sumFaturamentoEComissao(ytdOrders, comissaoByCliente);

  return {
    referenceDate,
    referenceLabel: labelDDMM(referenceDate),
    faturamentoDiaAnterior: prev.faturamento,
    comissaoDiaAnterior: prev.comissao,
    clientesNovosDiaAnterior,
    clientesTotais,
    comissaoAcumuladaYtd: ytd.comissao,
  };
}
