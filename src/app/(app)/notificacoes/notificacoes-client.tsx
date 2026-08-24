"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type NotificationItem = {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical" | string;
  title: string;
  body: string | null;
  entityType: string | null;
  readAt: string | null;
  createdAt: string;
};

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

const TYPE_LABEL: Record<string, string> = {
  roas_drop: "ROAS",
  low_stock: "Estoque",
  account_quality: "Conta",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Filter = "all" | "unread" | "critical";

export function NotificacoesClient() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    const response = await fetch("/api/notificacoes", { cache: "no-store" });
    if (!response.ok) {
      setItems([]);
      return;
    }
    const data = (await response.json()) as { notifications: NotificationItem[] };
    setItems(data.notifications);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!items) return [];
    if (filter === "unread") return items.filter((item) => !item.readAt);
    if (filter === "critical")
      return items.filter(
        (item) =>
          item.severity === "critical" ||
          SEVERITY_RANK[item.severity] === undefined,
      );
    return items;
  }, [items, filter]);

  const unreadCount = items?.filter((item) => !item.readAt).length ?? 0;

  async function markAllRead() {
    setItems(
      (prev) =>
        prev?.map((item) => ({
          ...item,
          readAt: item.readAt ?? new Date().toISOString(),
        })) ?? null,
    );
    await fetch("/api/notificacoes/ler", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => undefined);
  }

  async function markRead(id: string) {
    setItems(
      (prev) =>
        prev?.map((item) =>
          item.id === id && !item.readAt
            ? { ...item, readAt: new Date().toISOString() }
            : item,
        ) ?? null,
    );
    await fetch("/api/notificacoes/ler", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    }).catch(() => undefined);
  }

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "Todas" },
    { key: "unread", label: `Não lidas${unreadCount > 0 ? ` (${unreadCount})` : ""}` },
    { key: "critical", label: "Críticos" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Notificações
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Quedas de ROAS, estoque crítico em anúncio ativo e problemas de conta — avaliadas a cada sincronização.
          </p>
        </div>
        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={markAllRead}
            className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            Marcar todas como lidas
          </button>
        ) : null}
      </div>

      <div role="tablist" aria-label="Filtro de notificações" className="flex gap-1.5">
        {filters.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={filter === entry.key}
            onClick={() => setFilter(entry.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === entry.key
                ? "bg-[var(--w3-red)] text-white"
                : "border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-20 animate-pulse rounded-xl bg-[var(--bg-elevated)]"
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-strong)] px-6 py-14 text-center">
          <p className="text-base font-semibold text-[var(--text-primary)]">
            Nenhuma notificação por aqui
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-[var(--text-secondary)]">
            Quando uma campanha perder tração, um criativo estiver sem estoque
            ou uma conta precisar de reconexão, o aviso aparece aqui e no sino
            do topo.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {visible.map((item) => {
            const unread = !item.readAt;
            return (
              <li key={item.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                <button
                  type="button"
                  onClick={() => markRead(item.id)}
                  disabled={!unread}
                  title={unread ? "Marcar como lida" : undefined}
                  className={`flex w-full items-start gap-3 px-4 py-4 text-left transition-colors sm:px-5 ${
                    unread ? "bg-[color-mix(in_srgb,var(--w3-red)_4%,transparent)] hover:bg-[color-mix(in_srgb,var(--w3-red)_7%,transparent)]" : ""
                  } ${unread ? "cursor-pointer" : "cursor-default"}`}
                >
                  <span
                    aria-hidden
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${
                      item.severity === "critical"
                        ? "bg-[var(--danger)]"
                        : item.severity === "warning"
                          ? "bg-[var(--warning)]"
                          : "bg-[var(--info)]"
                    } ${unread ? "" : "opacity-40"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`text-sm ${
                          unread
                            ? "font-semibold text-[var(--text-primary)]"
                            : "font-normal text-[var(--text-secondary)]"
                        }`}
                      >
                        {item.title}
                      </span>
                      <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                        {TYPE_LABEL[item.type] ?? item.type}
                      </span>
                    </span>
                    {item.body ? (
                      <span className="mt-1 block text-sm leading-relaxed text-[var(--text-secondary)]">
                        {item.body}
                      </span>
                    ) : null}
                  </span>
                  <time
                    dateTime={item.createdAt}
                    className="shrink-0 pt-0.5 text-xs text-[var(--text-tertiary,var(--text-secondary))] [font-variant-numeric:tabular-nums]"
                  >
                    {formatDateTime(item.createdAt)}
                  </time>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
