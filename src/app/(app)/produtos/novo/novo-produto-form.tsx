"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { FotoUpload } from "../foto-upload";

type ClienteOption = { id: string; nome: string };

const CONDICOES: { value: string; label: string }[] = [
  { value: "new", label: "Novo" },
  { value: "used", label: "Usado" },
  { value: "not_specified", label: "Não especificado" },
];

const selectClass =
  "h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition duration-200 focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)] disabled:cursor-not-allowed disabled:opacity-60";

export function NovoProdutoForm({ clientes }: { clientes: ClienteOption[] }) {
  const router = useRouter();
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? "");
  const [nomeOriginal, setNomeOriginal] = useState("");
  const [fotoUrl, setFotoUrl] = useState("");
  const [preco, setPreco] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [condicao, setCondicao] = useState("new");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!clienteId) {
      setError("Selecione um cliente.");
      return;
    }
    const precoValue = Number(preco.replace(",", "."));
    if (!Number.isFinite(precoValue) || precoValue <= 0) {
      setError("Informe um preço válido.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/produtos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId,
          nomeOriginal: nomeOriginal.trim(),
          fotoUrl: fotoUrl || null,
          preco: precoValue,
          quantidade: Number(quantidade) || 1,
          condicao,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setError(data?.error ?? "Falha ao criar produto");
        return;
      }
      startTransition(() => {
        router.push("/produtos");
        router.refresh();
      });
    } catch {
      setError("Falha ao criar produto");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-[var(--text-primary)]">
        <span className="text-caption text-[var(--text-tertiary)]">
          Cliente
        </span>
        <select
          className={selectClass}
          disabled={submitting}
          onChange={(event) => setClienteId(event.target.value)}
          value={clienteId}
        >
          {clientes.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {cliente.nome}
            </option>
          ))}
        </select>
      </label>

      <Input
        disabled={submitting}
        label="Nome do produto"
        name="nomeOriginal"
        onChange={(event) => setNomeOriginal(event.target.value)}
        placeholder="Ex.: Fone Bluetooth XY"
        required
        value={nomeOriginal}
      />

      <FotoUpload clienteId={clienteId} onChange={setFotoUrl} value={fotoUrl} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          disabled={submitting}
          inputMode="decimal"
          label="Preço (R$)"
          name="preco"
          onChange={(event) => setPreco(event.target.value)}
          placeholder="99,90"
          required
          value={preco}
        />
        <Input
          disabled={submitting}
          label="Quantidade"
          min={1}
          name="quantidade"
          onChange={(event) => setQuantidade(event.target.value)}
          type="number"
          value={quantidade}
        />
      </div>

      <label className="grid gap-2 text-[var(--text-primary)] sm:max-w-xs">
        <span className="text-caption text-[var(--text-tertiary)]">
          Condição
        </span>
        <select
          className={selectClass}
          disabled={submitting}
          onChange={(event) => setCondicao(event.target.value)}
          value={condicao}
        >
          {CONDICOES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      <div className="flex justify-end">
        <Button disabled={submitting} type="submit">
          {submitting ? "Salvando…" : "Criar produto"}
        </Button>
      </div>
    </form>
  );
}
