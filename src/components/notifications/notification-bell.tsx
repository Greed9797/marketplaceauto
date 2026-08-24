"use client";

import { BellRing, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type NotificationItem = {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical" | string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

const POLL_INTERVAL_MS = 60_000;

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-[var(--danger)]",
  warning: "bg-[var(--warning)]",
  info: "bg-[var(--info)]",
};

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notificacoes", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as {
        notifications: NotificationItem[];
        unreadCount: number;
      };
      setItems(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // Silencioso: o sino é secundário e a próxima rodada tenta de novo.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function markAllRead() {
    setUnreadCount(0);
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        readAt: item.readAt ?? new Date().toISOString(),
      })),
    );
    await fetch("/api/notificacoes/ler", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => undefined);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={`Notificações${unreadCount > 0 ? ` (${unreadCount} não lidas)` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex size-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--w3-red)]"
      >
        <BellRing className="size-[18px]" strokeWidth={1.8} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-[var(--danger)] px-1 py-px text-[11px] font-semibold leading-none text-white [font-variant-numeric:tabular-nums]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notificações recentes"
          className="absolute right-0 top-12 z-50 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[0_16px_40px_-16px_rgba(24,17,12,0.28)]"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Notificações
              {unreadCount > 0 ? (
                <span className="ml-2 rounded-full bg-[var(--danger-bg)] px-2 py-0.5 text-xs font-medium text-[var(--danger)] [font-variant-numeric:tabular-nums]">
                  {unreadCount}
                </span>
              ) : null}
            </p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--w3-red)]"
              >
                <CheckCheck className="size-3.5" />
                Marcar lidas
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Tudo tranquilo por aqui
              </p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Avisos de ROAS, estoque e contas aparecem aqui.
              </p>
            </div>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {items.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <Link
                    href="/notificacoes"
                    onClick={() => setOpen(false)}
                    className="flex gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-muted,var(--bg-elevated))]"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${SEVERITY_DOT[item.severity] ?? SEVERITY_DOT.info}`}
                    />
                    <span className="min-w-0">
                      <span className="flex items-baseline justify-between gap-3">
                        <span
                          className={`truncate text-sm ${item.readAt ? "font-normal text-[var(--text-secondary)]" : "font-semibold text-[var(--text-primary)]"}`}
                        >
                          {item.title}
                        </span>
                        <time
                          dateTime={item.createdAt}
                          className="shrink-0 text-[11px] text-[var(--text-tertiary,var(--text-secondary))] [font-variant-numeric:tabular-nums]"
                        >
                          {relativeTime(item.createdAt)}
                        </time>
                      </span>
                      {item.body ? (
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-[var(--text-secondary)]">
                          {item.body}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-[var(--border-subtle)] px-4 py-2.5">
            <Link
              href="/notificacoes"
              onClick={() => setOpen(false)}
              className="block text-center text-xs font-semibold text-[var(--w3-red)] transition-opacity hover:opacity-80"
            >
              Ver todas as notificações
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
