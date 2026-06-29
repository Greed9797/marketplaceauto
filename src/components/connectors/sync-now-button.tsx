"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type SyncNowButtonProps = {
  connectorAccountId: string;
  label?: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
  lastSyncedAt?: string | Date | null;
};

type SyncResponseBody = {
  ok?: boolean;
  message?: string;
  durationMs?: number;
};

const STALE_SYNC_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function isStaleSync(lastSyncedAt: string | Date | null | undefined): boolean {
  if (!lastSyncedAt) return false;
  const date =
    lastSyncedAt instanceof Date ? lastSyncedAt : new Date(lastSyncedAt);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms > STALE_SYNC_THRESHOLD_MS;
}

function parseSyncBody(text: string): SyncResponseBody | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return parsed as SyncResponseBody;
    }
    return null;
  } catch {
    return null;
  }
}

export function SyncNowButton({
  connectorAccountId,
  label = "Sincronizar agora",
  size = "sm",
  variant = "primary",
  lastSyncedAt,
}: SyncNowButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const stale = isStaleSync(lastSyncedAt);

  async function trigger() {
    if (pending) return;
    setPending(true);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/connectors/${connectorAccountId}/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      const rawText = await response.text();
      const data = parseSyncBody(rawText);

      if (!response.ok || !data || !data.ok) {
        const fallback =
          response.status >= 500
            ? "A sincronização demorou mais que o limite e foi interrompida. Os dados recentes já entraram; o histórico continua sendo carregado em segundo plano. Tente de novo em instantes."
            : `Falha ao sincronizar (HTTP ${response.status}). Tente novamente.`;
        setFeedback({
          type: "error",
          message: data?.message ?? fallback,
        });
        return;
      }

      setFeedback({
        type: "success",
        message: data.durationMs
          ? `Sincronizado em ${Math.round(data.durationMs / 100) / 10}s`
          : "Sincronizado",
      });
      router.refresh();
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Erro inesperado.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        disabled={pending}
        onClick={trigger}
        size={size}
        type="button"
        variant={variant}
      >
        {pending ? "Sincronizando…" : label}
      </Button>
      {feedback ? (
        <span
          className={
            feedback.type === "success"
              ? "text-xs text-[var(--success)]"
              : "text-xs text-[var(--danger)]"
          }
        >
          {feedback.message}
        </span>
      ) : null}
      {stale && !feedback ? (
        <span className="text-xs text-[var(--text-secondary)]">
          ⚠ Última sync há mais de 24h
        </span>
      ) : null}
    </div>
  );
}
