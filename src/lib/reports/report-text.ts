import { formatCurrencyBR, formatIntegerBR } from "@/lib/utils/format-br";

/**
 * Values that make up the WhatsApp-style consolidated report. `clientesNovos`
 * and `churn` are entered by hand in the UI; everything else is computed.
 */
export type ReportTextInput = {
  referenceLabel: string; // DD/MM
  faturamentoDiaAnterior: number;
  comissaoDiaAnterior: number;
  clientesNovos: string; // free text — operator fills it in
  churn: string; // free text — operator fills it in
  clientesTotais: number;
  comissaoAcumuladaYtd: number;
};

const dash = (value: string) => (value.trim() === "" ? "—" : value.trim());

/** Builds the exact message the operator pastes into WhatsApp. */
export function buildMarketplaceReportText(input: ReportTextInput): string {
  return [
    "*W3 MARKETPLACE* 🛍️",
    `Faturamento dia anterior: ${formatCurrencyBR(input.faturamentoDiaAnterior)}`,
    `Comissão dia anterior: ${formatCurrencyBR(input.comissaoDiaAnterior)}`,
    `Clientes novos: ${dash(input.clientesNovos)}`,
    `Churn: ${dash(input.churn)}`,
    "",
    `CONSOLIDADO YTD. ${input.referenceLabel}`,
    `Clientes totais: ${formatIntegerBR(input.clientesTotais)}`,
    `Comissão acumulada: ${formatCurrencyBR(input.comissaoAcumuladaYtd)}`,
  ].join("\n");
}
