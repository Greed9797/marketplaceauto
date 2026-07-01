"use client";

import { Loader2, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

type ClienteOption = { id: string; nome: string };

/** Cliente filter that navigates to /produtos?clienteId=… on change. */
export function ProdutosFilter({
  clientes,
  selected,
}: {
  clientes: ClienteOption[];
  selected: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    const href = value
      ? `/produtos?clienteId=${encodeURIComponent(value)}`
      : "/produtos";
    startTransition(() => router.push(href));
  }

  return (
    <label className="grid gap-2 text-[var(--text-primary)] sm:max-w-xs">
      <span className="text-caption text-[var(--text-tertiary)]">
        Filtrar por cliente
      </span>
      <select
        aria-label="Filtrar por cliente"
        className="h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition duration-200 focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)] disabled:opacity-60"
        disabled={isPending}
        onChange={handleChange}
        value={selected}
      >
        <option value="">Todos os clientes</option>
        {clientes.map((cliente) => (
          <option key={cliente.id} value={cliente.id}>
            {cliente.nome}
          </option>
        ))}
      </select>
    </label>
  );
}

type PublishTarget = "shopee" | "ml" | null;

/** Per-row publish (Shopee/ML) + delete actions for a produto. */
export function ProdutoRowActions({ produtoId }: { produtoId: string }) {
  const router = useRouter();
  const [publishing, setPublishing] = useState<PublishTarget>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function publish(target: Exclude<PublishTarget, null>) {
    setError(null);
    setPublishing(target);
    try {
      const endpoint =
        target === "shopee" ? "/api/shopee/publicar" : "/api/ml/publicar";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setError(data?.error ?? "Falha ao publicar");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Falha ao publicar");
    } finally {
      setPublishing(null);
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/produtos/${produtoId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Falha ao excluir");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Falha ao excluir");
    } finally {
      setDeleting(false);
    }
  }

  const busy = publishing !== null || deleting;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          disabled={busy}
          onClick={() => publish("shopee")}
          size="sm"
          type="button"
          variant="secondary"
        >
          {publishing === "shopee" ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <Send aria-hidden className="size-3.5" />
          )}
          Shopee
        </Button>
        <Button
          disabled={busy}
          onClick={() => publish("ml")}
          size="sm"
          type="button"
          variant="secondary"
        >
          {publishing === "ml" ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <Send aria-hidden className="size-3.5" />
          )}
          Mercado Livre
        </Button>
        <Button
          aria-label="Excluir produto"
          disabled={busy}
          onClick={handleDelete}
          size="sm"
          type="button"
          variant="ghost"
        >
          {deleting ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <Trash2 aria-hidden className="size-3.5" />
          )}
        </Button>
      </div>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
