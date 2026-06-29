import type { DashboardSnapshot } from "@/lib/metrics/aggregator";
import { formatIntegerBR } from "@/lib/utils/format-br";

const labels = {
  impressions: "Impressões",
  clicks: "Cliques",
  sessions: "Sessões",
  orders: "Pedidos",
} as const;

export function FunnelW3({ funnel }: { funnel: DashboardSnapshot["funnel"] }) {
  const max = Math.max(funnel.impressions, funnel.clicks, funnel.sessions, funnel.orders, 1);
  const items = [
    ["impressions", funnel.impressions],
    ["clicks", funnel.clicks],
    ["sessions", funnel.sessions],
    ["orders", funnel.orders],
  ] as const;

  return (
    <div className="space-y-4">
      {items.map(([key, value]) => (
        <div className="grid gap-2" key={key}>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium">{labels[key]}</span>
            <span className="font-mono text-[var(--text-secondary)]">{formatIntegerBR(value)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--bg-elevated)]">
            <div
              className="h-full rounded-[var(--radius-pill)] bg-[var(--w3-red)]"
              style={{ width: `${Math.max((value / max) * 100, value > 0 ? 2 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
