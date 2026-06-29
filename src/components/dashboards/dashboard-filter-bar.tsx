"use client";

import { useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  dashboardCommerceProviderLabels,
  dashboardCommerceProviders,
  dashboardTrafficProviderLabels,
  dashboardTrafficProviders,
  toDateKey,
  type DashboardFilters,
  type DashboardPeriodPreset,
} from "@/lib/metrics/period";
import { cn } from "@/lib/utils/cn";

const presets: Array<{ value: DashboardPeriodPreset; label: string }> = [
  { value: "day", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "week", label: "7 Dias" },
  { value: "month", label: "Este Mês" },
];

const monthNames = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const weekDays = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

function selectedProviderParams(
  filters: DashboardFilters,
  includeProviderFilters = true,
) {
  const params = new URLSearchParams();
  if (includeProviderFilters) {
    filters.trafficProviders.forEach((provider) =>
      params.append("traffic", provider),
    );
    filters.commerceProviders.forEach((provider) =>
      params.append("commerce", provider),
    );
  }
  params.set("from", toDateKey(filters.period.from));
  params.set("to", toDateKey(filters.period.to));
  return params;
}

function presetHref(
  filters: DashboardFilters,
  preset: DashboardPeriodPreset,
  includeProviderFilters = true,
  actionPath = "/dashboard",
) {
  const params = selectedProviderParams(filters, includeProviderFilters);
  params.set("period", preset);
  return `${actionPath}?${params.toString()}`;
}

function monthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, amount: number) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1),
  );
}

function calendarDays(month: Date) {
  const first = monthStart(month);
  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const blanks = first.getUTCDay();

  return [
    ...Array.from({ length: blanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      return {
        day,
        key: `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    }),
  ];
}

function formatDisplayRange(from: string, to: string) {
  const [fromYear, fromMonth, fromDay] = from.split("-");
  const [toYear, toMonth, toDay] = to.split("-");
  return `${fromDay}/${fromMonth}/${fromYear} - ${toDay}/${toMonth}/${toYear}`;
}

export function DashboardFilterBar({
  actionPath = "/dashboard",
  filters,
  showProviderFilters = true,
}: {
  actionPath?: string;
  filters: DashboardFilters;
  showProviderFilters?: boolean;
}) {
  const { period } = filters;
  const formRef = useRef<HTMLFormElement>(null);
  const [from, setFrom] = useState(toDateKey(period.from));
  const [to, setTo] = useState(toDateKey(period.to));
  const [customControlsOpen, setCustomControlsOpen] = useState(
    period.preset === "custom",
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const isCustomPeriod = customControlsOpen || period.preset === "custom";
  const [visibleMonth, setVisibleMonth] = useState(monthStart(period.to));
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const monthLabel = `${monthNames[visibleMonth.getUTCMonth()]} ${visibleMonth.getUTCFullYear()}`;

  function selectDay(dateKey: string) {
    if (!from || from !== to) {
      setFrom(dateKey);
      setTo(dateKey);
      return;
    }

    if (dateKey < from) {
      setFrom(dateKey);
      setTo(from);
      return;
    }

    setTo(dateKey);
  }

  function isInRange(dateKey: string) {
    return dateKey >= from && dateKey <= to;
  }

  return (
    <section className="relative z-20 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 shadow-sm">
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-stretch">
        <nav
          className="grid grid-cols-2 gap-2 sm:flex"
          aria-label="Presets de período"
        >
          {presets.map((preset) => (
            <a
              className={cn(
                "inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-semibold transition-colors",
                period.preset === preset.value
                  ? "border-[var(--w3-red)] bg-[var(--w3-red-bg)] text-[var(--w3-red)]"
                  : "border-transparent bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--border-strong)]",
              )}
              href={presetHref(
                filters,
                preset.value,
                showProviderFilters,
                actionPath,
              )}
              key={preset.value}
            >
              {preset.label}
            </a>
          ))}
          <button
            className={cn(
              "inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-semibold transition-colors",
              isCustomPeriod
                ? "border-[var(--w3-red)] bg-[var(--w3-red-bg)] text-[var(--w3-red)]"
                : "border-transparent bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--border-strong)]",
            )}
            onClick={() => {
              setCustomControlsOpen(true);
              setCalendarOpen(false);
            }}
            type="button"
          >
            Personalizado
          </button>
        </nav>

        <form
          className={cn(
            "grid flex-1 gap-3 lg:grid-cols-2",
            showProviderFilters
              ? isCustomPeriod
                ? "2xl:grid-cols-[1fr_1.2fr_1.6fr_auto]"
                : "2xl:grid-cols-[1.2fr_1.6fr_auto]"
              : isCustomPeriod
                ? "2xl:grid-cols-[1fr_auto]"
                : "2xl:grid-cols-[auto]",
          )}
          action={actionPath}
          method="get"
          ref={formRef}
        >
          <input
            name="period"
            type="hidden"
            value={isCustomPeriod ? "custom" : period.preset}
          />
          <input name="from" type="hidden" value={from} />
          <input name="to" type="hidden" value={to} />

          {isCustomPeriod ? (
            <fieldset className="relative lg:min-w-[320px]">
              <legend className="sr-only">Período principal</legend>
              <span className="text-caption text-[var(--text-tertiary)]">
                Período
              </span>
              <div className="mt-1 flex gap-2">
                <button
                  className="inline-flex h-10 flex-1 items-center rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-left text-sm font-semibold text-[var(--text-primary)]"
                  onClick={() => setCalendarOpen((open) => !open)}
                  type="button"
                >
                  {formatDisplayRange(from, to)}
                </button>
                <Button
                  aria-label="Abrir calendário personalizado"
                  onClick={() => setCalendarOpen((open) => !open)}
                  size="icon"
                  type="button"
                  variant="secondary"
                >
                  <CalendarDays aria-hidden className="size-4" />
                </Button>
              </div>

              {calendarOpen ? (
                <div
                  className="fixed left-4 top-20 z-[1000] w-[360px] max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-[var(--text-primary)] shadow-lg"
                  data-calendar-panel="true"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <Button
                      aria-label="Mês anterior"
                      onClick={() =>
                        setVisibleMonth((current) => addMonths(current, -1))
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <ChevronLeft aria-hidden className="size-4" />
                    </Button>
                    <p className="text-sm font-semibold">{monthLabel}</p>
                    <Button
                      aria-label="Próximo mês"
                      onClick={() =>
                        setVisibleMonth((current) => addMonths(current, 1))
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <ChevronRight aria-hidden className="size-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-[0.68rem] font-semibold text-[var(--text-tertiary)]">
                    {weekDays.map((day) => (
                      <span className="py-1" key={day}>
                        {day}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-7 gap-1">
                    {days.map((item, index) =>
                      item ? (
                        <button
                          aria-label={`Dia ${item.day}`}
                          className={cn(
                            "relative z-20 grid h-9 place-items-center rounded-md text-sm transition-colors",
                            isInRange(item.key)
                              ? "bg-[var(--info-bg)] text-[var(--text-primary)]"
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]",
                            (item.key === from || item.key === to) &&
                              "bg-[var(--info)] text-white ring-2 ring-[var(--bg-surface)]",
                          )}
                          key={item.key}
                          onClick={() => selectDay(item.key)}
                          type="button"
                        >
                          {item.day}
                        </button>
                      ) : (
                        <span
                          aria-hidden
                          className="h-9"
                          key={`blank-${index}`}
                        />
                      ),
                    )}
                  </div>
                  <Button
                    aria-label="Aplicar período personalizado"
                    className="mt-5 w-full"
                    onClick={() => formRef.current?.requestSubmit()}
                    type="button"
                  >
                    Aplicar
                  </Button>
                </div>
              ) : null}
            </fieldset>
          ) : null}

          {showProviderFilters ? (
            <fieldset className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2">
              <legend className="mb-2 flex items-center gap-1 text-caption text-[var(--text-tertiary)]">
                <Filter aria-hidden className="size-3.5" />
                Anúncios
              </legend>
              <div className="flex flex-wrap gap-2">
                {dashboardTrafficProviders.map((provider) => (
                  <label
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs font-semibold"
                    key={provider}
                  >
                    <input
                      className="accent-[var(--w3-red)]"
                      defaultChecked={filters.trafficProviders.includes(
                        provider,
                      )}
                      name="traffic"
                      type="checkbox"
                      value={provider}
                    />
                    {dashboardTrafficProviderLabels[provider]}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {showProviderFilters ? (
            <fieldset className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2">
              <legend className="mb-2 flex items-center gap-1 text-caption text-[var(--text-tertiary)]">
                <CalendarDays aria-hidden className="size-3.5" />
                Marketplaces
              </legend>
              <div className="flex flex-wrap gap-2">
                {dashboardCommerceProviders.map((provider) => (
                  <label
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs font-semibold"
                    key={provider}
                  >
                    <input
                      className="accent-[var(--w3-red)]"
                      defaultChecked={filters.commerceProviders.includes(
                        provider,
                      )}
                      name="commerce"
                      type="checkbox"
                      value={provider}
                    />
                    {dashboardCommerceProviderLabels[provider]}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <Button
            aria-label="Recarregar dashboard"
            title="Recarregar dashboard"
            className="self-end"
            size="icon"
            type="submit"
            variant="primary"
          >
            <RefreshCw aria-hidden className="size-4" />
          </Button>
        </form>
      </div>
    </section>
  );
}
