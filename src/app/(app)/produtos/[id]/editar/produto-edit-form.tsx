"use client";

import { Loader2, Send, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { FotoUpload } from "../../foto-upload";

export type ProdutoEditData = {
  id: string;
  clienteId: string;
  nomeOriginal: string;
  fotoUrl: string;
  status: string;
  tituloMl: string;
  tituloShopee: string;
  descricao: string;
  categoriaMlId: string;
  categoriaShopeeId: string;
  preco: string;
  quantidade: string;
  condicao: string;
  atributos: string;
};

const CONDICOES: { value: string; label: string }[] = [
  { value: "new", label: "Novo" },
  { value: "used", label: "Usado" },
  { value: "not_specified", label: "Não especificado" },
];

const selectClass =
  "h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition duration-200 focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)] disabled:cursor-not-allowed disabled:opacity-60";

const textareaClass =
  "min-h-24 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition duration-200 placeholder:text-[var(--text-tertiary)] focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)] disabled:opacity-60";

type AiCopy = {
  tituloMl?: string;
  tituloShopee?: string;
  descricao?: string;
  categoriaMlSugerida?: string;
  categoriaShopeeId?: number;
  atributos?: Record<string, string>;
};

type Feedback = { tone: "success" | "danger"; message: string } | null;

export function ProdutoEditForm({ produto }: { produto: ProdutoEditData }) {
  const router = useRouter();
  const [values, setValues] = useState(produto);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState<"shopee" | "ml" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  function setField<K extends keyof ProdutoEditData>(
    key: K,
    value: ProdutoEditData[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const busy = saving || generating || publishing !== null;

  async function handleGenerate() {
    setFeedback(null);
    setGenerating(true);
    try {
      const response = await fetch("/api/ai/gerar-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId: produto.id }),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: AiCopy;
        error?: string;
      } | null;
      if (!response.ok || !body?.data) {
        setFeedback({
          tone: "danger",
          message: body?.error ?? "Falha ao gerar copy com IA.",
        });
        return;
      }
      const copy = body.data;
      setValues((current) => ({
        ...current,
        tituloMl: copy.tituloMl ?? current.tituloMl,
        tituloShopee: copy.tituloShopee ?? current.tituloShopee,
        descricao: copy.descricao ?? current.descricao,
        categoriaMlId: copy.categoriaMlSugerida ?? current.categoriaMlId,
        categoriaShopeeId:
          copy.categoriaShopeeId !== undefined
            ? String(copy.categoriaShopeeId)
            : current.categoriaShopeeId,
        atributos: copy.atributos
          ? JSON.stringify(copy.atributos, null, 2)
          : current.atributos,
      }));
      setFeedback({ tone: "success", message: "Copy gerada com IA." });
    } catch {
      setFeedback({ tone: "danger", message: "Falha ao gerar copy com IA." });
    } finally {
      setGenerating(false);
    }
  }

  function parseAtributos(): Record<string, unknown> | null | undefined {
    const raw = values.atributos.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return undefined;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const precoValue = Number(values.preco.replace(",", "."));
    if (!Number.isFinite(precoValue) || precoValue <= 0) {
      setFeedback({ tone: "danger", message: "Informe um preço válido." });
      return;
    }
    const atributos = parseAtributos();
    if (atributos === undefined) {
      setFeedback({
        tone: "danger",
        message: "Atributos devem ser um JSON de objeto válido.",
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/produtos/${produto.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomeOriginal: values.nomeOriginal.trim(),
          fotoUrl: values.fotoUrl || null,
          tituloMl: values.tituloMl || null,
          tituloShopee: values.tituloShopee || null,
          descricao: values.descricao || null,
          categoriaMlId: values.categoriaMlId || null,
          categoriaShopeeId: values.categoriaShopeeId
            ? Number(values.categoriaShopeeId)
            : null,
          preco: precoValue,
          quantidade: Number(values.quantidade) || 1,
          condicao: values.condicao,
          atributos,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setFeedback({
          tone: "danger",
          message: body?.error ?? "Falha ao salvar produto.",
        });
        return;
      }
      setFeedback({ tone: "success", message: "Produto salvo." });
      router.refresh();
    } catch {
      setFeedback({ tone: "danger", message: "Falha ao salvar produto." });
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(target: "shopee" | "ml") {
    setFeedback(null);
    setPublishing(target);
    try {
      const endpoint =
        target === "shopee" ? "/api/shopee/publicar" : "/api/ml/publicar";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId: produto.id }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setFeedback({
          tone: "danger",
          message: body?.error ?? "Falha ao publicar.",
        });
        return;
      }
      setFeedback({
        tone: "success",
        message: `Publicação em ${target === "shopee" ? "Shopee" : "Mercado Livre"} enviada.`,
      });
      router.refresh();
    } catch {
      setFeedback({ tone: "danger", message: "Falha ao publicar." });
    } finally {
      setPublishing(null);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={handleSave}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FotoUpload
          clienteId={produto.clienteId}
          onChange={(url) => setField("fotoUrl", url)}
          value={values.fotoUrl}
        />
        <Button
          disabled={busy}
          onClick={handleGenerate}
          type="button"
          variant="secondary"
        >
          {generating ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <Sparkles aria-hidden className="size-4" />
          )}
          Gerar com IA
        </Button>
      </div>

      <Input
        disabled={busy}
        label="Nome original"
        name="nomeOriginal"
        onChange={(event) => setField("nomeOriginal", event.target.value)}
        required
        value={values.nomeOriginal}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          disabled={busy}
          label="Título Mercado Livre"
          maxLength={60}
          name="tituloMl"
          onChange={(event) => setField("tituloMl", event.target.value)}
          value={values.tituloMl}
        />
        <Input
          disabled={busy}
          label="Título Shopee"
          maxLength={120}
          name="tituloShopee"
          onChange={(event) => setField("tituloShopee", event.target.value)}
          value={values.tituloShopee}
        />
      </div>

      <label className="grid gap-2 text-[var(--text-primary)]">
        <span className="text-caption text-[var(--text-tertiary)]">
          Descrição
        </span>
        <textarea
          className={textareaClass}
          disabled={busy}
          name="descricao"
          onChange={(event) => setField("descricao", event.target.value)}
          value={values.descricao}
        />
      </label>

      <div className="grid gap-5 sm:grid-cols-3">
        <Input
          disabled={busy}
          inputMode="decimal"
          label="Preço (R$)"
          name="preco"
          onChange={(event) => setField("preco", event.target.value)}
          required
          value={values.preco}
        />
        <Input
          disabled={busy}
          label="Quantidade"
          min={1}
          name="quantidade"
          onChange={(event) => setField("quantidade", event.target.value)}
          type="number"
          value={values.quantidade}
        />
        <label className="grid gap-2 text-[var(--text-primary)]">
          <span className="text-caption text-[var(--text-tertiary)]">
            Condição
          </span>
          <select
            className={selectClass}
            disabled={busy}
            onChange={(event) => setField("condicao", event.target.value)}
            value={values.condicao}
          >
            {CONDICOES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          disabled={busy}
          label="Categoria Mercado Livre"
          name="categoriaMlId"
          onChange={(event) => setField("categoriaMlId", event.target.value)}
          placeholder="Ex.: MLB1234"
          value={values.categoriaMlId}
        />
        <Input
          disabled={busy}
          label="Categoria Shopee (ID)"
          min={0}
          name="categoriaShopeeId"
          onChange={(event) =>
            setField("categoriaShopeeId", event.target.value)
          }
          type="number"
          value={values.categoriaShopeeId}
        />
      </div>

      <label className="grid gap-2 text-[var(--text-primary)]">
        <span className="text-caption text-[var(--text-tertiary)]">
          Atributos (JSON)
        </span>
        <textarea
          className={textareaClass}
          disabled={busy}
          name="atributos"
          onChange={(event) => setField("atributos", event.target.value)}
          placeholder='{"marca": "Genérica"}'
          spellCheck={false}
          value={values.atributos}
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

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          disabled={busy}
          onClick={() => handlePublish("shopee")}
          type="button"
          variant="secondary"
        >
          {publishing === "shopee" ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <Send aria-hidden className="size-4" />
          )}
          Publicar Shopee
        </Button>
        <Button
          disabled={busy}
          onClick={() => handlePublish("ml")}
          type="button"
          variant="secondary"
        >
          {publishing === "ml" ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <Send aria-hidden className="size-4" />
          )}
          Publicar Mercado Livre
        </Button>
        <Button disabled={busy} type="submit">
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
