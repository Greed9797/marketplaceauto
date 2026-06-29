"use client";

import { ArrowUpRight, FileText, PlugZap, SearchX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils/cn";

export type FaqConnectorCard = {
  label: string;
  href: string;
  type: "OAuth" | "Manual";
};

export type FaqBrowserGroup = {
  label: string;
  items: { title: string; href: string }[];
};

type FaqIndexBrowserProps = {
  connectors: FaqConnectorCard[];
  groups: FaqBrowserGroup[];
};

export function FaqIndexBrowser({ connectors, groups }: FaqIndexBrowserProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const filteredConnectors = useMemo(() => {
    if (!normalizedQuery) {
      return connectors;
    }
    return connectors.filter(
      (connector) =>
        connector.label.toLowerCase().includes(normalizedQuery) ||
        connector.type.toLowerCase().includes(normalizedQuery),
    );
  }, [connectors, normalizedQuery]);

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) {
      return groups;
    }
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          item.title.toLowerCase().includes(normalizedQuery),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, normalizedQuery]);

  const hasResults = filteredConnectors.length > 0 || filteredGroups.length > 0;

  return (
    <div className="space-y-10">
      <div className="relative">
        <svg
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--text-tertiary)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          aria-label="Buscar na documentação"
          className="h-11 w-full rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-10 pr-4 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--w3-red)] focus:ring-4 focus:ring-[var(--w3-red-bg)]"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar conector ou documentação…"
          type="search"
          value={query}
        />
      </div>

      {filteredConnectors.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
            Conectores
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredConnectors.map((connector) => (
              <Link
                className="group flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--w3-red)] hover:bg-[var(--bg-elevated)]"
                href={connector.href}
                key={connector.href}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--bg-elevated)] text-[var(--w3-red)] transition-colors group-hover:bg-[var(--bg-surface)]">
                  <PlugZap className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                    {connector.label}
                  </span>
                  <span
                    className={cn(
                      "mt-1.5 inline-flex rounded-[var(--radius-pill)] px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide",
                      connector.type === "OAuth"
                        ? "bg-[var(--info-bg)] text-[var(--info)]"
                        : "bg-[var(--success-bg)] text-[var(--success)]",
                    )}
                  >
                    {connector.type}
                  </span>
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-[var(--text-tertiary)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--w3-red)]" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {filteredGroups.map((group) => (
        <section key={group.label}>
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
            {group.label}
          </h2>
          <ul className="mt-3 divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-elevated)]"
                  href={item.href}
                >
                  <FileText className="size-4 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--w3-red)]" />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                    {item.title}
                  </span>
                  <ArrowUpRight className="size-4 shrink-0 text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {!hasResults ? (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-12 text-center">
          <SearchX className="size-6 text-[var(--text-tertiary)]" />
          <p className="text-sm text-[var(--text-secondary)]">
            Nada encontrado para “{query}”.
          </p>
        </div>
      ) : null}
    </div>
  );
}
