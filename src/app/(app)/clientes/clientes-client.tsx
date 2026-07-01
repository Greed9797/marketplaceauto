"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Inline form to create a new cliente (name only for Fase A). */
export function NovoClienteForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmed = nome.trim();
    if (!trimmed) {
      setError("Informe o nome do cliente");
      return;
    }

    try {
      const response = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: trimmed }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Falha ao criar cliente");
        return;
      }
      setNome("");
      startTransition(() => router.refresh());
    } catch {
      setError("Falha ao criar cliente");
    }
  }

  return (
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleSubmit}>
      <div className="flex-1">
        <Input
          disabled={isPending}
          label="Nome do cliente"
          name="nome"
          onChange={(event) => setNome(event.target.value)}
          placeholder="Ex.: Loja da Ana"
          value={nome}
        />
        {error ? (
          <p className="mt-1.5 text-xs text-[var(--danger)]">{error}</p>
        ) : null}
      </div>
      <Button disabled={isPending} type="submit">
        {isPending ? "Salvando…" : "Novo cliente"}
      </Button>
    </form>
  );
}

/** Disconnects a marketplace platform from a cliente via the DELETE endpoint. */
export function DisconnectButton({
  clienteId,
  platform,
  label,
}: {
  clienteId: string;
  platform: "shopee" | "ml";
  label: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleClick() {
    setError(null);
    try {
      const response = await fetch(
        `/api/auth/${platform}/disconnect?cliente_id=${encodeURIComponent(clienteId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Falha ao desconectar");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Falha ao desconectar");
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        disabled={isPending}
        onClick={handleClick}
        size="sm"
        type="button"
        variant="secondary"
      >
        {isPending ? "Removendo…" : label}
      </Button>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
