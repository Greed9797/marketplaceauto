"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import type { RoasReport } from "@/lib/metrics/roas-report";

const WINDOW_OPTIONS = [7, 30, 90] as const;

const SOURCE_OPTIONS = [
  { value: "", label: "Todas as plataformas" },
  { value: "SHOPEE_ADS", label: "Shopee Ads" },
  { value: "MERCADO_LIVRE_ADS", label: "Mercado Livre Ads" },
] as const;

function brl(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function formatRoas(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x`;
}

function formatCtr(value: number | null): string {
  return value === null
    ? "—"
    : `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

export function RoasReportCard({
  report,
  referenceDate,
}: {
  report: RoasReport;
  referenceDate: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isEmpty =
    report.days.length === 0 &&
    report.totals.spend === 0 &&
    report.totals.revenue === 0;

  function navigate(next: { janela?: number; fonte?: string }) {
    const params = new URLSearchParams({ date: referenceDate });
    const janela = next.janela ?? report.windowDays;
    const fonte = next.fonte ?? (report.source ?? "");
    params.set("janela", String(janela));
    if (fonte) params.set("fonte", fonte);

    startTransition(() => router.push(`/relatorios?${params.toString()}`));
  }

  return (
    <div className="space-y-4" data-testid="roas-report">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-[-0.01em]">
            Desempenho de ROAS
          </h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Investimento vs. faturamento sincronizado por plataforma.
          </p>
        </div>

        <div className="flex items-center gap-2" role="group" aria-label="Janela">
          {WINDOW_OPTIONS.map((option) => (
            <button
              aria-pressed={report.windowDays === option}
              className={
                report.windowDays === option
                  ? "rounded-md border border-transparent bg-[var(--w3-red)] px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }
              key={option}
              onClick={() => navigate({ janela: option })}
              type="button"
            >
              {option} dias
            </button>
          ))}

          <select
            aria-label="Plataforma"
            className="ml-2 rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm"
            onChange={(event) => navigate({ fonte: event.target.value })}
            value={report.source ?? ""}
          >
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {report.partialHistory && report.firstDataDate ? (
        <p className="rounded-md border border-[var(--border)] bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)] px-3 py-2 text-sm text-[var(--text-secondary)]" role="status">
          Histórico parcial: dados disponíveis a partir de{" "}
          {new Date(`${report.firstDataDate}T12:00:00Z`).toLocaleDateString("pt-BR")}.
        </p>
      ) : null}

      {isEmpty ? (
        <p className="py-10 text-center text-sm text-[var(--text-secondary)]" data-testid="roas-empty">
          Sem dados sincronizados para esta janela. Conecte os anúncios em
          /connectors e aguarde o próximo sync.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(
              [
                ["Investimento", brl(report.totals.spend)],
                ["Receita", brl(report.totals.revenue)],
                ["ROAS médio", formatRoas(report.totals.roas)],
                ["Pedidos", report.totals.orders.toLocaleString("pt-BR")],
                ["CTR", formatCtr(report.totals.ctr)],
              ] as const
            ).map(([label, value]) => (
              <div
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                key={label}
              >
                <dt className="text-caption text-[var(--text-tertiary)]">{label}</dt>
                <dd className="mt-1 text-sm font-semibold">{value}</dd>
              </div>
            ))}
          </dl>

          <table className="w-full text-left text-sm">
            <thead className="text-caption text-[var(--text-tertiary)]">
              <tr>
                <th className="py-2">Dia</th>
                <th className="py-2">Investimento</th>
                <th className="py-2">Receita</th>
                <th className="py-2">Pedidos</th>
              </tr>
            </thead>
            <tbody>
              {[...report.days].reverse().map((day) => (
                <tr className="border-t border-[var(--border)]" key={day.date}>
                  <td className="py-2">{day.date}</td>
                  <td className="py-2">{brl(day.spend)}</td>
                  <td className="py-2">{brl(day.revenue)}</td>
                  <td className="py-2">{day.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {isPending ? (
        <p aria-live="polite" className="sr-only">Atualizando relatório…</p>
      ) : null}
    </div>
  );
}
