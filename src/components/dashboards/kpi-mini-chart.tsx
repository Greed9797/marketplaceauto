"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrencyBR, formatPercentBR } from "@/lib/utils/format-br";

type KpiMiniChartProps = {
  accent: string;
  data: Array<{
    label: string;
    value: number;
    previousValue: number;
  }>;
  format: "currency" | "percent";
  showComparison?: boolean;
};

type TooltipPayload = {
  color?: string;
  dataKey?: string;
  name?: string;
  value?: number;
};

function formatValue(format: KpiMiniChartProps["format"], value: number) {
  return format === "percent" ? formatPercentBR(value) : formatCurrencyBR(value);
}

function ChartTooltip({
  active,
  format,
  label,
  payload,
}: {
  active?: boolean;
  format: KpiMiniChartProps["format"];
  label?: string;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-2 text-xs shadow-lg">
      <p className="mb-2 font-semibold text-[var(--text-primary)]">{label}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <p
            className="flex items-center gap-2 text-[var(--text-secondary)]"
            key={`${entry.dataKey ?? entry.name}-tooltip`}
          >
            <span
              className="size-2 rounded-[var(--radius-pill)]"
              style={{ backgroundColor: entry.color }}
            />
            {entry.name}: {formatValue(format, entry.value ?? 0)}
          </p>
        ))}
      </div>
    </div>
  );
}

export function KpiMiniChart({
  accent,
  data,
  format,
  showComparison = true,
}: KpiMiniChartProps) {
  const gradientId = `kpi-fill-${useId().replaceAll(":", "")}`;
  const hasCurrentData = data.some((item) => item.value !== 0);
  const hasPreviousData =
    showComparison && data.some((item) => item.previousValue !== 0);

  if (data.length < 2 || (!hasCurrentData && !hasPreviousData)) {
    return null;
  }

  return (
    <div className="mt-4 h-[74px] w-full">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart
          accessibilityLayer
          data={data}
          margin={{ bottom: 0, left: 0, right: 0, top: 8 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity={0.34} />
              <stop offset="100%" stopColor={accent} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--border-subtle)"
            strokeDasharray="3 5"
            vertical={false}
          />
          <XAxis dataKey="label" hide />
          <YAxis domain={["auto", "auto"]} hide />
          <Tooltip content={<ChartTooltip format={format} />} cursor={false} />
          {hasPreviousData ? (
            <Area
              dataKey="previousValue"
              dot={false}
              fill="transparent"
              isAnimationActive={false}
              name="Período anterior"
              stroke="var(--text-tertiary)"
              strokeDasharray="4 5"
              strokeOpacity={0.8}
              strokeWidth={1.6}
              type="monotone"
            />
          ) : null}
          <Area
            dataKey="value"
            dot={false}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            name="Período atual"
            stroke={accent}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.4}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
