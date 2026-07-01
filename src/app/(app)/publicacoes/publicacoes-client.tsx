"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

type ClienteOption = { id: string; nome: string };

export type PublicacoesFilterState = {
  clienteId: string;
  plataforma: string;
  status: string;
};

const selectClass =
  "h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition duration-200 focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)] disabled:opacity-60";

const STATUSES = ["pendente", "publicando", "publicado", "erro"];

export function PublicacoesFilters({
  clientes,
  value,
}: {
  clientes: ClienteOption[];
  value: PublicacoesFilterState;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function navigate(next: PublicacoesFilterState) {
    const query = new URLSearchParams();
    if (next.clienteId) query.set("clienteId", next.clienteId);
    if (next.plataforma) query.set("plataforma", next.plataforma);
    if (next.status) query.set("status", next.status);
    const suffix = query.toString();
    startTransition(() =>
      router.push(suffix ? `/publicacoes?${suffix}` : "/publicacoes"),
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="grid gap-2 text-[var(--text-primary)]">
        <span className="text-caption text-[var(--text-tertiary)]">Cliente</span>
        <select
          className={selectClass}
          disabled={isPending}
          onChange={(event) =>
            navigate({ ...value, clienteId: event.target.value })
          }
          value={value.clienteId}
        >
          <option value="">Todos</option>
          {clientes.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {cliente.nome}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-2 text-[var(--text-primary)]">
        <span className="text-caption text-[var(--text-tertiary)]">
          Plataforma
        </span>
        <select
          className={selectClass}
          disabled={isPending}
          onChange={(event) =>
            navigate({ ...value, plataforma: event.target.value })
          }
          value={value.plataforma}
        >
          <option value="">Todas</option>
          <option value="SHOPEE">Shopee</option>
          <option value="MERCADO_LIVRE">Mercado Livre</option>
        </select>
      </label>

      <label className="grid gap-2 text-[var(--text-primary)]">
        <span className="text-caption text-[var(--text-tertiary)]">Status</span>
        <select
          className={selectClass}
          disabled={isPending}
          onChange={(event) =>
            navigate({ ...value, status: event.target.value })
          }
          value={value.status}
        >
          <option value="">Todos</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function RetryButton({ publicacaoId }: { publicacaoId: string }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleRetry() {
    setError(null);
    setRetrying(true);
    try {
      const response = await fetch(
        `/api/publicacoes/${publicacaoId}/retry`,
        { method: "POST" },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Falha ao reprocessar");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Falha ao reprocessar");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={retrying}
        onClick={handleRetry}
        size="sm"
        type="button"
        variant="secondary"
      >
        {retrying ? (
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw aria-hidden className="size-3.5" />
        )}
        Tentar novamente
      </Button>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
