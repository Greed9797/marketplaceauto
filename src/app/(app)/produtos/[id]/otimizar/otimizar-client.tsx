"use client";

import {
  ImagePlus,
  Loader2,
  Save,
  Sparkles,
  Star,
  Trash2,
  Wand2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FotoUpload } from "@/app/(app)/produtos/foto-upload";
import {
  calcularScore,
  type ScoreCriterion,
} from "@/lib/publisher/listing-score";
import { cn } from "@/lib/utils/cn";

type ProdutoState = {
  nomeOriginal: string;
  imagens: string[];
  fotoUrl: string | null;
  tituloMl: string;
  tituloShopee: string;
  descricao: string;
  categoriaMlId: string;
  categoriaShopeeId: number | null;
  atributos: Record<string, string>;
  preco: number;
  quantidade: number;
  condicao: string;
};

type Props = {
  produtoId: string;
  clienteId: string;
  initialScore: number;
  breakdown: ScoreCriterion[];
  initial: ProdutoState;
};

function scoreColor(score: number): string {
  if (score >= 80) return "var(--success)";
  if (score >= 50) return "var(--warning)";
  return "var(--danger)";
}

/** Anel de progresso 0-100. */
function ScoreGauge({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, score)) / 100);
  const color = scoreColor(score);
  return (
    <div className="relative grid size-32 place-items-center">
      <svg className="size-32 -rotate-90" viewBox="0 0 120 120">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth="10"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <div className="absolute grid place-items-center text-center">
        <span className="text-3xl font-bold" style={{ color }}>
          {score}
        </span>
        <span className="text-[0.625rem] uppercase tracking-wide text-[var(--text-tertiary)]">
          / 100
        </span>
      </div>
    </div>
  );
}

export function OtimizarClient({
  produtoId,
  clienteId,
  initial,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState<ProdutoState>(initial);
  const [atributosText, setAtributosText] = useState(() =>
    Object.entries(initial.atributos)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
  );
  const [saving, setSaving] = useState(false);
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Parse "chave: valor" por linha → Record.
  const atributos = useMemo(() => {
    const out: Record<string, string> = {};
    for (const line of atributosText.split("\n")) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k && v) out[k] = v;
    }
    return out;
  }, [atributosText]);

  // Score ao vivo enquanto edita.
  const { score, breakdown } = useMemo(
    () =>
      calcularScore({
        tituloMl: state.tituloMl,
        tituloShopee: state.tituloShopee,
        descricao: state.descricao,
        imagens: state.imagens,
        fotoUrl: state.fotoUrl,
        atributos,
        categoriaMlId: state.categoriaMlId,
        categoriaShopeeId: state.categoriaShopeeId,
        preco: state.preco,
        quantidade: state.quantidade,
      }),
    [state, atributos],
  );

  function patch(next: Partial<ProdutoState>) {
    setState((prev) => ({ ...prev, ...next }));
  }

  function addImagem(url: string) {
    setState((prev) => {
      if (prev.imagens.includes(url)) return prev;
      const imagens = [...prev.imagens, url];
      return { ...prev, imagens, fotoUrl: prev.fotoUrl ?? url };
    });
  }

  function removeImagem(url: string) {
    setState((prev) => {
      const imagens = prev.imagens.filter((i) => i !== url);
      const fotoUrl =
        prev.fotoUrl === url ? (imagens[0] ?? null) : prev.fotoUrl;
      return { ...prev, imagens, fotoUrl };
    });
  }

  async function gerarCopy() {
    setError(null);
    setMsg(null);
    setGeneratingCopy(true);
    try {
      const response = await fetch("/api/ai/gerar-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId }),
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        data?: {
          tituloMl?: string;
          tituloShopee?: string;
          descricao?: string;
          categoriaShopeeId?: number;
          atributos?: Record<string, string>;
        };
      } | null;
      if (!response.ok || !data?.success || !data.data) {
        setError(data?.error ?? "Falha ao gerar com IA");
        return;
      }
      const c = data.data;
      patch({
        tituloMl: c.tituloMl ?? state.tituloMl,
        tituloShopee: c.tituloShopee ?? state.tituloShopee,
        descricao: c.descricao ?? state.descricao,
        categoriaShopeeId: c.categoriaShopeeId ?? state.categoriaShopeeId,
      });
      if (c.atributos && Object.keys(c.atributos).length > 0) {
        setAtributosText(
          Object.entries(c.atributos)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n"),
        );
      }
      setMsg("Conteúdo gerado — revise e salve.");
    } catch {
      setError("Falha ao gerar com IA");
    } finally {
      setGeneratingCopy(false);
    }
  }

  async function gerarImagem() {
    setError(null);
    setMsg(null);
    setGeneratingImage(true);
    try {
      const response = await fetch("/api/ai/gerar-imagem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId }),
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        data?: { url?: string };
      } | null;
      if (!response.ok || !data?.success || !data.data?.url) {
        setError(data?.error ?? "Falha ao gerar imagem");
        return;
      }
      addImagem(data.data.url);
      setMsg("Imagem gerada e adicionada à galeria.");
    } catch {
      setError("Falha ao gerar imagem");
    } finally {
      setGeneratingImage(false);
    }
  }

  async function salvar() {
    setError(null);
    setMsg(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/produtos/${produtoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomeOriginal: state.nomeOriginal,
          fotoUrl: state.fotoUrl,
          imagens: state.imagens,
          tituloMl: state.tituloMl || null,
          tituloShopee: state.tituloShopee || null,
          descricao: state.descricao || null,
          categoriaMlId: state.categoriaMlId || null,
          categoriaShopeeId: state.categoriaShopeeId,
          preco: state.preco,
          quantidade: state.quantidade,
          condicao: state.condicao,
          atributos,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.success) {
        setError(data?.error ?? "Falha ao salvar");
        return;
      }
      setMsg("Anúncio salvo.");
      router.refresh();
    } catch {
      setError("Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)]";

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        {/* Galeria */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Imagens ({state.imagens.length})</CardTitle>
            <Button
              disabled={generatingImage}
              onClick={gerarImagem}
              size="sm"
              type="button"
            >
              {generatingImage ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <Sparkles aria-hidden className="size-3.5" />
              )}
              Gerar imagem com IA
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.imagens.length > 0 ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {state.imagens.map((url) => {
                  const isCover = state.fotoUrl === url;
                  return (
                    <div
                      key={url}
                      className={cn(
                        "group relative overflow-hidden rounded-md border",
                        isCover
                          ? "border-[var(--w3-red)]"
                          : "border-[var(--border-subtle)]",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt="Imagem do produto"
                        className="aspect-square w-full object-cover"
                        src={url}
                      />
                      {isCover ? (
                        <span className="absolute left-1 top-1 rounded bg-[var(--w3-red)] px-1.5 py-0.5 text-[0.625rem] font-semibold text-white">
                          Capa
                        </span>
                      ) : null}
                      <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-black/50 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          className="rounded p-1 text-white hover:text-[var(--w3-red)]"
                          onClick={() => patch({ fotoUrl: url })}
                          title="Definir como capa"
                          type="button"
                        >
                          <Star className="size-3.5" />
                        </button>
                        <button
                          className="rounded p-1 text-white hover:text-[var(--danger)]"
                          onClick={() => removeImagem(url)}
                          title="Remover"
                          type="button"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
                <ImagePlus className="size-4" /> Nenhuma imagem ainda.
              </p>
            )}
            <FotoUpload clienteId={clienteId} value="" onChange={addImagem} />
          </CardContent>
        </Card>

        {/* Conteúdo */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Conteúdo do anúncio</CardTitle>
            <Button
              disabled={generatingCopy}
              onClick={gerarCopy}
              size="sm"
              type="button"
              variant="secondary"
            >
              {generatingCopy ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <Wand2 aria-hidden className="size-3.5" />
              )}
              Gerar com IA
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="grid gap-1.5">
              <span className="text-caption text-[var(--text-tertiary)]">
                Título Mercado Livre (máx. 60)
              </span>
              <input
                className={inputCls}
                maxLength={60}
                onChange={(e) => patch({ tituloMl: e.target.value })}
                value={state.tituloMl}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-caption text-[var(--text-tertiary)]">
                Título Shopee (máx. 120)
              </span>
              <input
                className={inputCls}
                maxLength={120}
                onChange={(e) => patch({ tituloShopee: e.target.value })}
                value={state.tituloShopee}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-caption text-[var(--text-tertiary)]">
                Descrição
              </span>
              <textarea
                className={cn(inputCls, "h-40 resize-y py-2")}
                onChange={(e) => patch({ descricao: e.target.value })}
                value={state.descricao}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-caption text-[var(--text-tertiary)]">
                Ficha técnica (uma por linha: chave: valor)
              </span>
              <textarea
                className={cn(inputCls, "h-32 resize-y py-2 font-mono text-xs")}
                onChange={(e) => setAtributosText(e.target.value)}
                placeholder={"Marca: W3\nMaterial: Algodão\nTamanho: M"}
                value={atributosText}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-caption text-[var(--text-tertiary)]">
                  Preço (R$)
                </span>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  onChange={(e) =>
                    patch({ preco: Number(e.target.value) || 0 })
                  }
                  type="number"
                  value={state.preco}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-caption text-[var(--text-tertiary)]">
                  Estoque
                </span>
                <input
                  className={inputCls}
                  onChange={(e) =>
                    patch({ quantidade: Number(e.target.value) || 0 })
                  }
                  type="number"
                  value={state.quantidade}
                />
              </label>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Painel de score */}
      <div className="space-y-4">
        <Card className="xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle>Score do anúncio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid place-items-center">
              <ScoreGauge score={score} />
            </div>
            <ul className="space-y-2">
              {breakdown.map((c) => (
                <li key={c.criterio} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-primary)]">
                      {c.criterio}
                    </span>
                    <span
                      className="font-medium"
                      style={{
                        color:
                          c.pontos === c.max
                            ? "var(--success)"
                            : c.pontos > 0
                              ? "var(--warning)"
                              : "var(--text-tertiary)",
                      }}
                    >
                      {c.pontos}/{c.max}
                    </span>
                  </div>
                  {c.dica ? (
                    <p className="text-xs text-[var(--text-tertiary)]">
                      {c.dica}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <Button
              className="w-full"
              disabled={saving}
              onClick={salvar}
              type="button"
            >
              {saving ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Save aria-hidden className="size-4" />
              )}
              Salvar anúncio
            </Button>
            {msg ? (
              <p className="text-sm text-[var(--success)]">{msg}</p>
            ) : null}
            {error ? (
              <p className="text-sm text-[var(--danger)]">{error}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
