import { ConnectorProvider } from "@prisma/client";

import { GoogleAdsLogo, MetaAdsLogo } from "@/components/providers/provider-logo";
import type { DashboardSnapshot } from "@/lib/metrics/aggregator";
import { formatCurrencyBR, formatRoasBR } from "@/lib/utils/format-br";

function ProviderBadge({ source }: { source: ConnectorProvider }) {
  if (source === ConnectorProvider.META_ADS) {
    return (
      <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--info-bg)] px-2 py-1 text-[0.6875rem] font-semibold uppercase text-[var(--info)]">
        <MetaAdsLogo className="size-4 rounded-[5px] shadow-none" />
        Meta ROAS
      </span>
    );
  }

  if (source === ConnectorProvider.GOOGLE_ADS) {
    return (
      <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--success-bg)] px-2 py-1 text-[0.6875rem] font-semibold uppercase text-[var(--success)]">
        <GoogleAdsLogo className="size-4 shadow-none" />
        Valor conv./custo
      </span>
    );
  }

  return null;
}

export function TopCampaignsTable({
  campaigns,
}: {
  campaigns: DashboardSnapshot["topCampaigns"];
}) {
  if (!campaigns.length) {
    return (
      <p className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-6 text-sm text-[var(--text-secondary)]">
        Sem campanhas com investimento nesse período.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-strong)] bg-[var(--bg-elevated)] text-caption text-[var(--text-tertiary)]">
            <th className="px-4 py-3">Campanha</th>
            <th className="px-4 py-3">Plataforma</th>
            <th className="px-4 py-3 text-right">Receita atribuída</th>
            <th className="px-4 py-3 text-right">Investimento</th>
            <th className="px-4 py-3 text-right">ROAS</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign, index) => (
            <tr
              className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]"
              key={campaign.campaignId}
            >
              <td className={index === 0 ? "border-l-[3px] border-[var(--w3-gold)] px-4 py-3" : "px-4 py-3"}>
                <span className="font-medium">{campaign.campaignName}</span>
              </td>
              <td className="px-4 py-3">
                <ProviderBadge source={campaign.source} />
              </td>
              <td className="px-4 py-3 text-right font-mono">
                {formatCurrencyBR(campaign.conversionsValue)}
              </td>
              <td className="px-4 py-3 text-right font-mono">{formatCurrencyBR(campaign.spend)}</td>
              <td className="px-4 py-3 text-right font-mono">{formatRoasBR(campaign.roas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
