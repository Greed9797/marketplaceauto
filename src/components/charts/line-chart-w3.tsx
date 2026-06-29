"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrencyBR } from "@/lib/utils/format-br";

type LineChartW3Props = {
  data: Array<{
    label: string;
    revenue: number;
    spend: number;
    previousRevenue?: number;
    previousSpend?: number;
  }>;
};

type TooltipPayload = {
  color?: string;
  name?: string;
  value?: number;
};

function ChartTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] p-3 text-sm shadow-lg">
      <p className="mb-2 font-semibold text-[var(--text-primary)]">{label}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <p className="flex items-center gap-2 text-[var(--text-secondary)]" key={entry.name}>
            <span
              className="size-2 rounded-[var(--radius-pill)]"
              style={{ backgroundColor: entry.color }}
            />
            {entry.name}: {formatCurrencyBR(entry.value ?? 0)}
          </p>
        ))}
      </div>
    </div>
  );
}

export function LineChartW3({ data }: LineChartW3Props) {
  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer height="100%" width="100%">
        <LineChart accessibilityLayer data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="4 4" />
          <XAxis
            axisLine={false}
            dataKey="label"
            minTickGap={18}
            tick={{ fill: "var(--text-tertiary)", fontSize: 12 }}
            tickLine={false}
          />
          <YAxis
            axisLine={false}
            tick={{ fill: "var(--text-tertiary)", fontSize: 12 }}
            tickFormatter={(value) => `R$ ${Number(value) / 1000}k`}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<ChartTooltip />} />
          <Line
            dataKey="revenue"
            dot={false}
            name="Faturamento"
            stroke="var(--w3-red)"
            strokeWidth={2}
            type="monotone"
          />
          <Line
            dataKey="previousRevenue"
            dot={false}
            name="Faturamento anterior"
            stroke="var(--text-tertiary)"
            strokeDasharray="5 5"
            strokeWidth={1.5}
            type="monotone"
          />
          <Line
            dataKey="spend"
            dot={false}
            name="Investimento"
            stroke="var(--w3-gold)"
            strokeWidth={2}
            type="monotone"
          />
          <Line
            dataKey="previousSpend"
            dot={false}
            name="Investimento anterior"
            stroke="var(--border-strong)"
            strokeDasharray="4 6"
            strokeWidth={1.5}
            type="monotone"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
