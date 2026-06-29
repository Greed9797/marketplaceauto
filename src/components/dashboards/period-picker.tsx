import { Button } from "@/components/ui/button";
import type { DashboardPeriod } from "@/lib/metrics/period";
import { toDateKey } from "@/lib/metrics/period";
import { cn } from "@/lib/utils/cn";

const presets = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "month", label: "Mês atual" },
] as const;

export function PeriodPicker({ period }: { period: DashboardPeriod }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <a
            className={cn(
              "inline-flex h-10 items-center rounded-md border px-4 text-sm font-semibold transition-colors",
              period.preset === preset.value
                ? "border-[var(--w3-red)] bg-[var(--w3-red-bg)] text-[var(--w3-red)]"
                : "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]",
            )}
            href={`/dashboard?period=${preset.value}`}
            key={preset.value}
          >
            {preset.label}
          </a>
        ))}
      </div>
      <form className="grid gap-2 sm:grid-cols-[minmax(0,150px)_minmax(0,150px)_auto]" method="get">
        <input name="period" type="hidden" value="custom" />
        <label className="grid gap-2">
          <span className="text-caption text-[var(--text-tertiary)]">De</span>
          <input
            className="h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm"
            defaultValue={toDateKey(period.from)}
            name="from"
            type="date"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-caption text-[var(--text-tertiary)]">Até</span>
          <input
            className="h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm"
            defaultValue={toDateKey(period.to)}
            name="to"
            type="date"
          />
        </label>
        <Button className="self-end" type="submit" variant="secondary">
          Aplicar
        </Button>
      </form>
    </div>
  );
}
