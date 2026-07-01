"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MarketplaceReport } from "@/lib/reports/marketplace-report";
import { buildMarketplaceReportText } from "@/lib/reports/report-text";

export function RelatorioClient({ report }: { report: MarketplaceReport }) {
  const router = useRouter();
  const [clientesNovos, setClientesNovos] = useState(
    String(report.clientesNovosDiaAnterior),
  );
  const [churn, setChurn] = useState("");
  const [copied, setCopied] = useState(false);

  const text = useMemo(
    () =>
      buildMarketplaceReportText({
        referenceLabel: report.referenceLabel,
        faturamentoDiaAnterior: report.faturamentoDiaAnterior,
        comissaoDiaAnterior: report.comissaoDiaAnterior,
        clientesNovos,
        churn,
        clientesTotais: report.clientesTotais,
        comissaoAcumuladaYtd: report.comissaoAcumuladaYtd,
      }),
    [report, clientesNovos, churn],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-5">
        <Input
          label="Data de referência"
          name="date"
          onChange={(event) =>
            router.push(`/relatorios?date=${event.target.value}`)
          }
          type="date"
          value={report.referenceDate}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            inputMode="numeric"
            label="Clientes novos (manual)"
            name="clientesNovos"
            onChange={(event) => setClientesNovos(event.target.value)}
            placeholder="0"
            value={clientesNovos}
          />
          <Input
            inputMode="numeric"
            label="Churn (manual)"
            name="churn"
            onChange={(event) => setChurn(event.target.value)}
            placeholder="0"
            value={churn}
          />
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          Faturamento e comissão são calculados a partir dos pedidos pagos e do
          percentual de comissão de cada cliente. Clientes novos e churn são
          preenchidos por você.
        </p>
      </div>

      <div className="grid content-start gap-3">
        <pre className="whitespace-pre-wrap rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-4 text-sm leading-relaxed text-[var(--text-primary)]">
          {text}
        </pre>
        <div className="flex justify-end">
          <Button onClick={handleCopy} type="button">
            {copied ? "Copiado!" : "Copiar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
