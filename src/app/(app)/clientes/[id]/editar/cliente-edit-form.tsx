"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ClienteEditData = {
  id: string;
  nome: string;
  nicho: string;
  estiloDescricao: string;
  exemplosTitulos: string;
  exemplosDescricoes: string;
  dadosFiscais: string;
  comissaoPercent: string;
};

const textareaClass =
  "min-h-24 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition duration-200 placeholder:text-[var(--text-tertiary)] focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)] disabled:opacity-60";

type Feedback = { tone: "success" | "danger"; message: string } | null;

export function ClienteEditForm({ cliente }: { cliente: ClienteEditData }) {
  const router = useRouter();
  const [values, setValues] = useState(cliente);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [, startTransition] = useTransition();

  function setField<K extends keyof ClienteEditData>(
    key: K,
    value: ClienteEditData[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    if (!values.nome.trim()) {
      setFeedback({ tone: "danger", message: "Informe o nome do cliente." });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/clientes/${cliente.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: values.nome.trim(),
          nicho: values.nicho,
          estiloDescricao: values.estiloDescricao,
          exemplosTitulos: values.exemplosTitulos,
          exemplosDescricoes: values.exemplosDescricoes,
          dadosFiscais: values.dadosFiscais,
          comissaoPercent: values.comissaoPercent,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setFeedback({
          tone: "danger",
          message: body?.error ?? "Falha ao salvar cliente.",
        });
        return;
      }
      setFeedback({ tone: "success", message: "Cliente atualizado." });
      startTransition(() => router.refresh());
    } catch {
      setFeedback({ tone: "danger", message: "Falha ao salvar cliente." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          disabled={saving}
          label="Nome"
          name="nome"
          onChange={(event) => setField("nome", event.target.value)}
          required
          value={values.nome}
        />
        <Input
          disabled={saving}
          label="Nicho"
          name="nicho"
          onChange={(event) => setField("nicho", event.target.value)}
          placeholder="Ex.: Moda feminina"
          value={values.nicho}
        />
        <Input
          disabled={saving}
          inputMode="decimal"
          label="Comissão (%)"
          name="comissaoPercent"
          onChange={(event) => setField("comissaoPercent", event.target.value)}
          placeholder="Ex.: 5"
          value={values.comissaoPercent}
        />
      </div>

      <label className="grid gap-2 text-[var(--text-primary)]">
        <span className="text-caption text-[var(--text-tertiary)]">
          Estilo de descrição
        </span>
        <textarea
          className={textareaClass}
          disabled={saving}
          name="estiloDescricao"
          onChange={(event) => setField("estiloDescricao", event.target.value)}
          placeholder="Tom de voz, público-alvo, diretrizes de escrita…"
          value={values.estiloDescricao}
        />
      </label>

      <label className="grid gap-2 text-[var(--text-primary)]">
        <span className="text-caption text-[var(--text-tertiary)]">
          Exemplos de títulos
        </span>
        <textarea
          className={textareaClass}
          disabled={saving}
          name="exemplosTitulos"
          onChange={(event) => setField("exemplosTitulos", event.target.value)}
          placeholder="Um exemplo por linha"
          value={values.exemplosTitulos}
        />
      </label>

      <label className="grid gap-2 text-[var(--text-primary)]">
        <span className="text-caption text-[var(--text-tertiary)]">
          Exemplos de descrições
        </span>
        <textarea
          className={textareaClass}
          disabled={saving}
          name="exemplosDescricoes"
          onChange={(event) =>
            setField("exemplosDescricoes", event.target.value)
          }
          placeholder="Um exemplo por linha"
          value={values.exemplosDescricoes}
        />
      </label>

      <label className="grid gap-2 text-[var(--text-primary)]">
        <span className="text-caption text-[var(--text-tertiary)]">
          Dados fiscais
        </span>
        <textarea
          className={textareaClass}
          disabled={saving}
          name="dadosFiscais"
          onChange={(event) => setField("dadosFiscais", event.target.value)}
          placeholder="CNPJ, razão social, endereço fiscal…"
          value={values.dadosFiscais}
        />
      </label>

      {feedback ? (
        <p
          className={
            feedback.tone === "success"
              ? "text-sm text-[var(--success)]"
              : "text-sm text-[var(--danger)]"
          }
        >
          {feedback.message}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button disabled={saving} type="submit">
          {saving ? "Salvando…" : "Salvar cliente"}
        </Button>
      </div>
    </form>
  );
}
