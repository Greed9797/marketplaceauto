import type {
  DashboardBreakdownItem,
  DashboardCategoryRow,
  DashboardConnectorRankingRow,
  DashboardProductRow,
  DashboardSnapshot,
} from "@/lib/metrics/aggregator";
import {
  dashboardCommerceProviderLabels,
  dashboardTrafficProviderLabels,
} from "@/lib/metrics/period";
import {
  formatCurrencyBR,
  formatIntegerBR,
  formatPercentBR,
  formatRoasBR,
} from "@/lib/utils/format-br";
import { cn } from "@/lib/utils/cn";
import { ConnectorProvider } from "@prisma/client";

function providerLabel(provider: ConnectorProvider) {
  if (provider in dashboardTrafficProviderLabels) {
    return dashboardTrafficProviderLabels[
      provider as keyof typeof dashboardTrafficProviderLabels
    ];
  }

  if (provider in dashboardCommerceProviderLabels) {
    return dashboardCommerceProviderLabels[
      provider as keyof typeof dashboardCommerceProviderLabels
    ];
  }

  return provider;
}

const campaignStatusLabels: Record<string, string> = {
  ACTIVE: "Ativa",
  ENABLED: "Ativa",
  PAUSED: "Pausada",
  CAMPAIGN_PAUSED: "Pausada",
  ADSET_PAUSED: "Pausada",
  DISABLED: "Desativada",
  INACTIVE: "Inativa",
  REMOVED: "Removida",
  DELETED: "Removida",
  ARCHIVED: "Arquivada",
  ENDED: "Encerrada",
  PENDING_REVIEW: "Em análise",
  DISAPPROVED: "Reprovada",
  WITH_ISSUES: "Com problemas",
  LEARNING: "Aprendizado",
};

const campaignObjectiveLabels: Record<string, string> = {
  OUTCOME_SALES: "Vendas",
  SALES: "Vendas",
  CONVERSIONS: "Conversões",
  OUTCOME_LEADS: "Leads",
  LEADS: "Leads",
  OUTCOME_TRAFFIC: "Tráfego",
  TRAFFIC: "Tráfego",
  OUTCOME_ENGAGEMENT: "Engajamento",
  ENGAGEMENT: "Engajamento",
  OUTCOME_AWARENESS: "Reconhecimento",
  AWARENESS: "Reconhecimento",
  OUTCOME_APP_PROMOTION: "Promoção de app",
  APP_PROMOTION: "Promoção de app",
  PERFORMANCE_MAX: "Cobertura máxima",
  SEARCH: "Busca",
  DISPLAY: "Display",
  SHOPPING: "Produto",
  VIDEO: "Vídeo",
  DEMAND_GEN: "Descoberta",
  MULTI_CHANNEL: "Multicanal",
  LOCAL: "Loja",
  SMART: "Automático",
};

function campaignStatusLabel(status: string | null) {
  if (!status) {
    return "Sem dado";
  }

  const normalized = status.toUpperCase();
  return campaignStatusLabels[normalized] ?? humanizeApiValue(normalized);
}

function campaignObjectiveLabel(objective: string | null) {
  if (!objective) {
    return "Sem dado";
  }

  return objective
    .split("/")
    .map((part) => {
      const normalized = part.trim().toUpperCase();
      return (
        campaignObjectiveLabels[normalized] ?? humanizeApiValue(normalized)
      );
    })
    .join(" / ");
}

function humanizeApiValue(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function campaignStatusClassName(status: string | null) {
  const normalized = status?.toUpperCase();

  if (normalized === "ACTIVE" || normalized === "ENABLED") {
    return "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]";
  }

  if (
    normalized === "PAUSED" ||
    normalized === "CAMPAIGN_PAUSED" ||
    normalized === "ADSET_PAUSED" ||
    normalized === "ENDED" ||
    normalized === "ARCHIVED"
  ) {
    return "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning)]";
  }

  if (
    normalized === "DISABLED" ||
    normalized === "INACTIVE" ||
    normalized === "REMOVED" ||
    normalized === "DELETED" ||
    normalized === "DISAPPROVED"
  ) {
    return "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]";
  }

  if (normalized === "PENDING_REVIEW" || normalized === "LEARNING") {
    return "border-[var(--info)] bg-[var(--info-bg)] text-[var(--info)]";
  }

  return "border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]";
}

function CampaignStatusBadge({ status }: { status: string | null }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-[var(--radius-pill)] border-[4px] px-2.5 py-1 text-[0.68rem] font-bold uppercase leading-none tracking-[0.04em]",
        campaignStatusClassName(status),
      )}
    >
      {campaignStatusLabel(status)}
    </span>
  );
}

function formatOptionalCurrencyBR(value: number | null) {
  return value === null ? "Sem dado" : formatCurrencyBR(value);
}

export function ProductsTable({
  products,
}: {
  products: DashboardProductRow[];
}) {
  if (!products.length) {
    return (
      <div className="grid min-h-[176px] place-items-center rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-6 text-center text-sm text-[var(--text-secondary)]">
        Ainda não recebemos itens de pedido normalizados nesse período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="bg-[var(--bg-elevated)] text-caption text-[var(--text-tertiary)]">
            <th className="px-3 py-3 text-left">Nome do produto</th>
            <th className="px-3 py-3 text-right">Estoque disponível</th>
            <th className="px-3 py-3 text-right">Quantidade vendida</th>
            <th className="px-3 py-3 text-right">Receita total</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr
              className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-elevated)]"
              key={product.productName}
            >
              <td className="px-3 py-4 font-semibold">{product.productName}</td>
              <td className="px-3 py-4 text-right font-mono">
                {product.stockQuantity === null
                  ? "Sem dado"
                  : product.stockQuantity === "unlimited"
                    ? "Disponível"
                    : formatIntegerBR(product.stockQuantity)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatIntegerBR(product.quantitySold)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatCurrencyBR(product.revenue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CategoriesTable({
  categories,
}: {
  categories: DashboardCategoryRow[];
}) {
  if (!categories.length) {
    return (
      <div className="grid min-h-[176px] place-items-center rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-6 text-center text-sm text-[var(--text-secondary)]">
        Ainda não recebemos categorias reais dos itens vendidos nesse período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="bg-[var(--bg-elevated)] text-caption text-[var(--text-tertiary)]">
            <th className="px-3 py-3 text-left">Categoria</th>
            <th className="px-3 py-3 text-right">Receita total</th>
            <th className="px-3 py-3 text-right">Qtd. vendida</th>
            <th className="px-3 py-3 text-right">% do total</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr
              className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-elevated)]"
              key={category.categoryName}
            >
              <td className="px-3 py-4 font-semibold">
                {category.categoryName}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatCurrencyBR(category.revenue)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatIntegerBR(category.quantitySold)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatPercentBR(category.percent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StateSalesTable({
  states,
}: {
  states: DashboardBreakdownItem[];
}) {
  if (!states.length) {
    return (
      <div className="grid min-h-[176px] place-items-center rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-6 text-center text-sm text-[var(--text-secondary)]">
        Sem dados de estado nos pedidos normalizados desse período.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="bg-[var(--bg-elevated)] text-caption text-[var(--text-tertiary)]">
            <th className="px-3 py-3 text-left">Estado</th>
            <th className="px-3 py-3 text-right">Receita total</th>
            <th className="px-3 py-3 text-right">% do total</th>
          </tr>
        </thead>
        <tbody>
          {states.map((state, index) => (
            <tr
              className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-elevated)]"
              key={state.label}
            >
              <td
                className={
                  index === 0
                    ? "border-l-[3px] border-[var(--w3-gold)] px-3 py-4 font-semibold"
                    : "px-3 py-4 font-semibold"
                }
              >
                {state.label}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatCurrencyBR(state.value)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatPercentBR(state.percent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CampaignsTable({
  campaigns,
}: {
  campaigns: DashboardSnapshot["topCampaigns"];
}) {
  if (!campaigns.length) {
    return (
      <div className="grid min-h-[176px] place-items-center rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-6 text-center text-sm text-[var(--text-secondary)]">
        Sem campanhas com investimento real no período selecionado.
      </div>
    );
  }

  const totals = campaigns.reduce(
    (sum, campaign) => ({
      spend: sum.spend + campaign.spend,
      impressions: sum.impressions + campaign.impressions,
      clicks: sum.clicks + campaign.clicks,
      conversions: sum.conversions + campaign.conversions,
      conversionsValue: sum.conversionsValue + campaign.conversionsValue,
      addToCart: sum.addToCart + campaign.addToCart,
    }),
    {
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      conversionsValue: 0,
      addToCart: 0,
    },
  );
  const totalCtr =
    totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const totalCpc = totals.clicks > 0 ? totals.spend / totals.clicks : null;
  const totalCostPerConversion =
    totals.conversions > 0 ? totals.spend / totals.conversions : null;
  const totalConversionsPerCost =
    totals.spend > 0 ? totals.conversionsValue / totals.spend : 0;
  const totalCostPerAddToCart =
    totals.addToCart > 0 ? totals.spend / totals.addToCart : null;
  const performanceReturnLabel =
    campaigns[0]?.source === ConnectorProvider.META_ADS
      ? "ROAS"
      : "Conv./Custo";

  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
      <table className="w-full min-w-[1180px] text-sm">
        <thead>
          <tr className="bg-[var(--bg-elevated)] text-caption text-[var(--text-tertiary)]">
            <th className="px-3 py-3 text-left">Campanha</th>
            <th className="px-3 py-3 text-left">Status</th>
            <th className="px-3 py-3 text-left">Tipo de anúncio</th>
            <th className="px-3 py-3 text-right">Conv.</th>
            <th className="px-3 py-3 text-right">Custo/conv.</th>
            <th className="px-3 py-3 text-right">Investimento</th>
            <th className="px-3 py-3 text-right">{performanceReturnLabel}</th>
            <th className="px-3 py-3 text-right">Custo/Add to Cart</th>
            <th className="px-3 py-3 text-right">Cliques</th>
            <th className="px-3 py-3 text-right">CTR</th>
            <th className="px-3 py-3 text-right">CPC</th>
            <th className="px-3 py-3 text-right">Impressões</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign, index) => (
            <tr
              className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-elevated)]"
              key={`${campaign.source}:${campaign.campaignId}`}
            >
              <td
                className={
                  index === 0
                    ? "border-l-[3px] border-[var(--w3-gold)] px-3 py-4"
                    : "px-3 py-4"
                }
              >
                <span className="font-semibold">{campaign.campaignName}</span>
              </td>
              <td className="px-3 py-4">
                <CampaignStatusBadge status={campaign.campaignStatus} />
              </td>
              <td className="px-3 py-4 text-[var(--text-secondary)]">
                {campaignObjectiveLabel(campaign.campaignObjective)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatIntegerBR(Math.round(campaign.conversions))}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatOptionalCurrencyBR(campaign.costPerConversion)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatCurrencyBR(campaign.spend)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatRoasBR(campaign.conversionsPerCost)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatOptionalCurrencyBR(campaign.costPerAddToCart)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatIntegerBR(campaign.clicks)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatPercentBR(campaign.ctr)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatOptionalCurrencyBR(campaign.cpc)}
              </td>
              <td className="px-3 py-4 text-right font-mono">
                {formatIntegerBR(campaign.impressions)}
              </td>
            </tr>
          ))}
          <tr className="bg-[var(--bg-elevated)] font-semibold">
            <td className="px-3 py-4">Total</td>
            <td className="px-3 py-4 text-[var(--text-secondary)]">—</td>
            <td className="px-3 py-4 text-[var(--text-secondary)]">—</td>
            <td className="px-3 py-4 text-right font-mono">
              {formatIntegerBR(Math.round(totals.conversions))}
            </td>
            <td className="px-3 py-4 text-right font-mono">
              {formatOptionalCurrencyBR(totalCostPerConversion)}
            </td>
            <td className="px-3 py-4 text-right font-mono">
              {formatCurrencyBR(totals.spend)}
            </td>
            <td className="px-3 py-4 text-right font-mono">
              {formatRoasBR(totalConversionsPerCost)}
            </td>
            <td className="px-3 py-4 text-right font-mono">
              {formatOptionalCurrencyBR(totalCostPerAddToCart)}
            </td>
            <td className="px-3 py-4 text-right font-mono">
              {formatIntegerBR(totals.clicks)}
            </td>
            <td className="px-3 py-4 text-right font-mono">
              {formatPercentBR(totalCtr)}
            </td>
            <td className="px-3 py-4 text-right font-mono">
              {formatOptionalCurrencyBR(totalCpc)}
            </td>
            <td className="px-3 py-4 text-right font-mono">
              {formatIntegerBR(totals.impressions)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ConnectorRankingTable({
  ranking,
}: {
  ranking: DashboardConnectorRankingRow[];
}) {
  if (!ranking.length) {
    return (
      <div className="grid min-h-[176px] place-items-center rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-6 text-center text-sm text-[var(--text-secondary)]">
        Sem lojas ou contas com dados no período filtrado.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="bg-[var(--bg-elevated)] text-caption text-[var(--text-tertiary)]">
            <th className="px-3 py-3 text-left">Conta/Loja</th>
            <th className="px-3 py-3 text-left">Plataforma</th>
            <th className="px-3 py-3 text-right">Faturamento</th>
            <th className="px-3 py-3 text-right">Investido</th>
            <th className="px-3 py-3 text-right">ROAS</th>
            <th className="px-3 py-3 text-right">% mídia</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((row, index) => (
            <tr
              className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]"
              key={row.connectorAccountId}
            >
              <td className="px-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-[var(--text-tertiary)]">
                    {index + 1}º
                  </span>
                  <span className="font-medium">{row.accountName}</span>
                </div>
              </td>
              <td className="px-3 py-3 text-[var(--text-secondary)]">
                {providerLabel(row.provider)}
              </td>
              <td className="px-3 py-3 text-right font-mono">
                {formatCurrencyBR(row.revenue)}
              </td>
              <td className="px-3 py-3 text-right font-mono">
                {formatCurrencyBR(row.spend)}
              </td>
              <td className="px-3 py-3 text-right font-mono">
                {formatRoasBR(row.roas)}
              </td>
              <td className="px-3 py-3 text-right font-mono">
                {formatPercentBR(row.mediaRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
