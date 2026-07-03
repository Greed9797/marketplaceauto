"use client";

import {
  CheckCircle2,
  FileText,
  Gauge,
  ImagePlus,
  ListChecks,
  Loader2,
  Package,
  Rocket,
  Save,
  Sparkles,
  Star,
  Trash2,
  Wand2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
  pesoGramas: number | null;
  comprimentoCm: number | null;
  larguraCm: number | null;
  alturaCm: number | null;
};

type Props = {
  produtoId: string;
  clienteId: string;
  /** Muda quando o produto é atualizado no servidor (produto.updatedAt) —
   * dispara a ressincronização do estado local (real-time após IA/harness). */
  syncKey: string;
  initialScore: number;
  breakdown: ScoreCriterion[];
  initial: ProdutoState;
};

/** Atributo obrigatório da categoria (espelha RequiredAttribute do backend). */
type RequiredAttr = {
  id: string;
  name: string;
  required: boolean;
  type: string;
  options?: { id: string; name: string }[];
  units?: string[];
  freeText: boolean;
};

type Validation = {
  ok: boolean;
  problemas: { campo: string; mensagem: string }[];
};

type Preview = {
  platform: "ml" | "shopee";
  connected: boolean;
  categoryResolved: boolean;
  alreadyPublished: boolean;
  requiredAttributes: RequiredAttr[];
  validation: Validation;
};

function scoreColor(score: number): string {
  if (score >= 80) return "var(--success)";
  if (score >= 50) return "var(--warning)";
  return "var(--danger)";
}

function scoreVerdict(score: number): string {
  if (score >= 80) return "Ótimo";
  if (score >= 50) return "Melhorar";
  return "Incompleto";
}

/** Anel de progresso 0-100. */
function ScoreGauge({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, score)) / 100);
  const color = scoreColor(score);
  return (
    <div className="relative grid size-40 place-items-center">
      <svg className="size-40 -rotate-90" viewBox="0 0 120 120">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth="8"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.5s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute grid place-items-center text-center">
        <span
          className="text-[3.25rem] font-bold leading-none tabular-nums"
          style={{ color }}
        >
          {score}
        </span>
        <span
          className="mt-1.5 text-xs font-semibold uppercase tracking-[0.14em]"
          style={{ color }}
        >
          {scoreVerdict(score)}
        </span>
      </div>
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--w3-red)] focus:bg-[var(--bg-surface)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)]";

export function OtimizarClient({
  produtoId,
  clienteId,
  syncKey,
  initial,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState<ProdutoState>(initial);
  // Ressincroniza o formulário quando o servidor muda o produto (ex.: copiloto
  // ou harness aplicaram algo → router.refresh traz novo syncKey). Sem isso, o
  // useState local ignora os novos props e só atualiza após reload manual.
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const carregarPreviewRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    setState(initialRef.current);
    void carregarPreviewRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);
  // Atributos "extras": os que NÃO são obrigatórios da categoria ficam nesta
  // textarea livre; os obrigatórios viram campos dirigidos (union do preview).
  const [saving, setSaving] = useState(false);
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<{
    ml: Preview;
    shopee: Preview;
  } | null>(null);
  const [publishing, setPublishing] = useState<"ml" | "shopee" | null>(null);
  const [confirm, setConfirm] = useState<"ml" | "shopee" | null>(null);
  const [harnessRunning, setHarnessRunning] = useState(false);
  const [harness, setHarness] = useState<{
    rounds: { n: number; score: number; publicavel: boolean }[];
    finalScore: number;
    publicavel: boolean;
    converged: boolean;
  } | null>(null);

  // Atributos obrigatórios (dedup por nome) das duas plataformas conectadas.
  const requiredAttrs = useMemo<RequiredAttr[]>(() => {
    if (!preview) return [];
    const byName = new Map<string, RequiredAttr>();
    for (const p of [preview.ml, preview.shopee]) {
      for (const a of p.requiredAttributes) {
        if (!a.required) continue;
        if (!byName.has(a.name)) byName.set(a.name, a);
      }
    }
    return [...byName.values()];
  }, [preview]);

  const requiredNames = useMemo(
    () => new Set(requiredAttrs.map((a) => a.name)),
    [requiredAttrs],
  );

  // Textarea de extras: só as chaves fora do conjunto obrigatório.
  const extrasText = useMemo(
    () =>
      Object.entries(state.atributos)
        .filter(([k]) => !requiredNames.has(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
    [state.atributos, requiredNames],
  );

  // Score ao vivo enquanto edita.
  const { score, breakdown } = useMemo(
    () =>
      calcularScore({
        tituloMl: state.tituloMl,
        tituloShopee: state.tituloShopee,
        descricao: state.descricao,
        imagens: state.imagens,
        fotoUrl: state.fotoUrl,
        atributos: state.atributos,
        categoriaMlId: state.categoriaMlId,
        categoriaShopeeId: state.categoriaShopeeId,
        preco: state.preco,
        quantidade: state.quantidade,
      }),
    [state],
  );

  // Prontidão de publicação — o foco decisivo do painel (pronto vs. ajustes).
  const readiness = useMemo(() => {
    if (!preview) return null;
    const plats = [preview.ml, preview.shopee].filter((p) => p.connected);
    if (plats.length === 0) return { connected: false, prontas: 0, pend: 0 };
    const prontas = plats.filter(
      (p) => p.alreadyPublished || p.validation.ok,
    ).length;
    const pend = plats.reduce(
      (n, p) => n + (p.validation.ok ? 0 : p.validation.problemas.length),
      0,
    );
    return { connected: true, prontas, pend };
  }, [preview]);

  function patch(next: Partial<ProdutoState>) {
    setState((prev) => ({ ...prev, ...next }));
  }

  function setAttr(name: string, value: string) {
    setState((prev) => {
      const atributos = { ...prev.atributos };
      if (value.trim()) atributos[name] = value;
      else delete atributos[name];
      return { ...prev, atributos };
    });
  }

  function setExtras(text: string) {
    setState((prev) => {
      // Preserva os obrigatórios; reconstrói só a parte "extras" da textarea.
      const atributos: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev.atributos)) {
        if (requiredNames.has(k)) atributos[k] = v;
      }
      for (const line of text.split("\n")) {
        const idx = line.indexOf(":");
        if (idx <= 0) continue;
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (k && v && !requiredNames.has(k)) atributos[k] = v;
      }
      return { ...prev, atributos };
    });
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

  const carregarPreview = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/produtos/${produtoId}/publicar-preview`,
      );
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: { ml: Preview; shopee: Preview };
      } | null;
      if (response.ok && data?.success && data.data) setPreview(data.data);
    } catch {
      // Preview é auxiliar — falha silenciosa mantém a tela utilizável.
    }
  }, [produtoId]);
  carregarPreviewRef.current = carregarPreview;

  useEffect(() => {
    void carregarPreview();
  }, [carregarPreview]);

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
      setState((prev) => ({
        ...prev,
        tituloMl: c.tituloMl ?? prev.tituloMl,
        tituloShopee: c.tituloShopee ?? prev.tituloShopee,
        descricao: c.descricao ?? prev.descricao,
        categoriaShopeeId: c.categoriaShopeeId ?? prev.categoriaShopeeId,
        atributos:
          c.atributos && Object.keys(c.atributos).length > 0
            ? { ...prev.atributos, ...c.atributos }
            : prev.atributos,
      }));
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

  async function salvar(): Promise<boolean> {
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
          atributos: state.atributos,
          pesoGramas: state.pesoGramas,
          comprimentoCm: state.comprimentoCm,
          larguraCm: state.larguraCm,
          alturaCm: state.alturaCm,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.success) {
        setError(data?.error ?? "Falha ao salvar");
        return false;
      }
      setMsg("Anúncio salvo.");
      router.refresh();
      await carregarPreview();
      return true;
    } catch {
      setError("Falha ao salvar");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publicar(platform: "ml" | "shopee") {
    setConfirm(null);
    setError(null);
    setMsg(null);
    // Salva antes: o publish lê o produto do banco, não o estado local.
    const saved = await salvar();
    if (!saved) return;
    setPublishing(platform);
    try {
      const url =
        platform === "ml" ? "/api/ml/publicar" : "/api/shopee/publicar";
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId }),
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.success) {
        setError(data?.error ?? "Falha ao publicar");
        return;
      }
      setMsg(
        platform === "ml"
          ? "Publicado no Mercado Livre."
          : "Publicado na Shopee.",
      );
      router.refresh();
      await carregarPreview();
    } catch {
      setError("Falha ao publicar");
    } finally {
      setPublishing(null);
    }
  }

  async function otimizarAuto() {
    setError(null);
    setMsg(null);
    setHarness(null);
    // Salva o estado atual antes: o harness lê o produto do banco.
    const saved = await salvar();
    if (!saved) return;
    setHarnessRunning(true);
    try {
      const response = await fetch("/api/copilot/harness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId }),
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        data?: {
          rounds: { n: number; score: number; publicavel: boolean }[];
          finalScore: number;
          publicavel: boolean;
          converged: boolean;
        };
      } | null;
      if (!response.ok || !data?.success || !data.data) {
        setError(data?.error ?? "Falha na otimização automática");
        return;
      }
      setHarness(data.data);
      setMsg(
        data.data.converged
          ? "Otimização automática concluída — anúncio pronto."
          : `Otimização parou em ${data.data.finalScore}/100. Revise as pendências.`,
      );
      router.refresh();
      await carregarPreview();
    } catch {
      setError("Falha na otimização automática");
    } finally {
      setHarnessRunning(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        {/* Galeria */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ImagePlus className="size-4 text-[var(--text-tertiary)]" />
              Imagens ({state.imagens.length})
            </CardTitle>
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
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4 text-[var(--text-tertiary)]" />
              Conteúdo do anúncio
            </CardTitle>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-caption text-[var(--text-tertiary)]">
                  Categoria Mercado Livre (ex: MLB1234)
                </span>
                <input
                  className={inputCls}
                  onChange={(e) => patch({ categoriaMlId: e.target.value })}
                  placeholder="Auto-resolvida se vazio"
                  value={state.categoriaMlId}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-caption text-[var(--text-tertiary)]">
                  Categoria Shopee (ID)
                </span>
                <input
                  className={inputCls}
                  onChange={(e) =>
                    patch({
                      categoriaShopeeId: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                  type="number"
                  value={state.categoriaShopeeId ?? ""}
                />
              </label>
            </div>
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

        {/* Ficha técnica dirigida pelos atributos obrigatórios */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-4 text-[var(--text-tertiary)]" />
              Ficha técnica
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {requiredAttrs.length > 0 ? (
              <div className="space-y-3">
                <p className="text-caption text-[var(--text-tertiary)]">
                  Campos exigidos pela categoria:
                </p>
                {requiredAttrs.map((attr) => {
                  const value = state.atributos[attr.name] ?? "";
                  return (
                    <label key={attr.name} className="grid gap-1.5">
                      <span className="text-caption text-[var(--text-primary)]">
                        {attr.name}
                        <span className="text-[var(--danger)]"> *</span>
                      </span>
                      {attr.options && attr.options.length > 0 ? (
                        <select
                          className={inputCls}
                          onChange={(e) => setAttr(attr.name, e.target.value)}
                          value={value}
                        >
                          <option value="">Selecione…</option>
                          {attr.options.map((o) => (
                            <option key={o.id || o.name} value={o.name}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className={inputCls}
                          onChange={(e) => setAttr(attr.name, e.target.value)}
                          placeholder={
                            attr.units?.length
                              ? `Valor + unidade (${attr.units.join(", ")})`
                              : undefined
                          }
                          value={value}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-caption text-[var(--text-tertiary)]">
                Conecte uma conta e defina a categoria para ver os campos
                exigidos.
              </p>
            )}
            <label className="grid gap-1.5">
              <span className="text-caption text-[var(--text-tertiary)]">
                Outros atributos (uma por linha: chave: valor)
              </span>
              <textarea
                className={cn(inputCls, "h-28 resize-y py-2 font-mono text-xs")}
                onChange={(e) => setExtras(e.target.value)}
                placeholder={"Material: Algodão\nCor: Preto"}
                value={extrasText}
              />
            </label>
          </CardContent>
        </Card>

        {/* Embalagem (Shopee exige) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="size-4 text-[var(--text-tertiary)]" />
              Embalagem
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-4">
            <label className="grid gap-1.5">
              <span className="text-caption text-[var(--text-tertiary)]">
                Peso (g)
              </span>
              <input
                className={inputCls}
                onChange={(e) =>
                  patch({
                    pesoGramas: e.target.value ? Number(e.target.value) : null,
                  })
                }
                type="number"
                value={state.pesoGramas ?? ""}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-caption text-[var(--text-tertiary)]">
                Compr. (cm)
              </span>
              <input
                className={inputCls}
                onChange={(e) =>
                  patch({
                    comprimentoCm: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
                type="number"
                value={state.comprimentoCm ?? ""}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-caption text-[var(--text-tertiary)]">
                Larg. (cm)
              </span>
              <input
                className={inputCls}
                onChange={(e) =>
                  patch({
                    larguraCm: e.target.value ? Number(e.target.value) : null,
                  })
                }
                type="number"
                value={state.larguraCm ?? ""}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-caption text-[var(--text-tertiary)]">
                Alt. (cm)
              </span>
              <input
                className={inputCls}
                onChange={(e) =>
                  patch({
                    alturaCm: e.target.value ? Number(e.target.value) : null,
                  })
                }
                type="number"
                value={state.alturaCm ?? ""}
              />
            </label>
          </CardContent>
        </Card>
      </div>

      {/* Painel lateral */}
      <div className="space-y-4">
        <Card className="border-[var(--w3-red-bg)] shadow-sm ring-1 ring-[var(--w3-red-bg)] xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-4 text-[var(--w3-red)]" />
              Score do anúncio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid place-items-center pt-1">
              <ScoreGauge score={score} />
            </div>
            {readiness ? (
              <div
                className="flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold"
                style={
                  !readiness.connected
                    ? {
                        background: "var(--bg-canvas)",
                        color: "var(--text-tertiary)",
                      }
                    : readiness.prontas > 0 && readiness.pend === 0
                      ? {
                          background: "var(--w3-red-bg)",
                          color: "var(--success)",
                        }
                      : {
                          background: "var(--bg-canvas)",
                          color: "var(--warning)",
                        }
                }
              >
                {!readiness.connected ? (
                  "Conecte uma loja para publicar"
                ) : readiness.pend === 0 && readiness.prontas > 0 ? (
                  <>
                    <CheckCircle2 className="size-4" /> Pronto para publicar
                  </>
                ) : (
                  <>
                    <XCircle className="size-4" /> {readiness.pend} ajuste
                    {readiness.pend === 1 ? "" : "s"} para publicar
                  </>
                )}
              </div>
            ) : null}
            <ul className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
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
              className="h-11 w-full text-[0.9rem] font-semibold"
              disabled={saving}
              onClick={() => void salvar()}
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

        {/* Otimização automática (eval harness M3) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="size-4 text-[var(--w3-red)]" />
              Otimizar com IA (auto)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-caption text-[var(--text-tertiary)]">
              O copiloto melhora o anúncio em rodadas até ficar publicável.
              Aplica só conteúdo — não publica sozinho.
            </p>
            <Button
              className="w-full"
              disabled={harnessRunning}
              onClick={() => void otimizarAuto()}
              type="button"
              variant="secondary"
            >
              {harnessRunning ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Wand2 aria-hidden className="size-4" />
              )}
              {harnessRunning ? "Otimizando…" : "Otimizar automaticamente"}
            </Button>
            {harness ? (
              <ul className="space-y-1">
                {harness.rounds.map((r) => (
                  <li
                    key={r.n}
                    className="flex items-center justify-between text-xs text-[var(--text-tertiary)]"
                  >
                    <span>Rodada {r.n}</span>
                    <span
                      style={{
                        color: r.publicavel
                          ? "var(--success)"
                          : "var(--text-secondary)",
                      }}
                    >
                      {r.score}/100 {r.publicavel ? "· pronto" : ""}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-1 text-xs font-medium">
                  <span className="text-[var(--text-primary)]">Final</span>
                  <span
                    style={{
                      color: harness.converged
                        ? "var(--success)"
                        : "var(--warning)",
                    }}
                  >
                    {harness.finalScore}/100
                  </span>
                </li>
              </ul>
            ) : null}
          </CardContent>
        </Card>

        {/* Publicar */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="size-4 text-[var(--w3-red)]" />
              Publicar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview ? (
              <>
                <PublishRow
                  label="Mercado Livre"
                  preview={preview.ml}
                  busy={publishing === "ml"}
                  onPublish={() => setConfirm("ml")}
                />
                <PublishRow
                  label="Shopee"
                  preview={preview.shopee}
                  busy={publishing === "shopee"}
                  onPublish={() => setConfirm("shopee")}
                />
              </>
            ) : (
              <p className="text-caption text-[var(--text-tertiary)]">
                Verificando requisitos…
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirmação de publicação */}
      {confirm ? (
        <ConfirmDialog
          title={`Publicar em ${confirm === "ml" ? "Mercado Livre" : "Shopee"}?`}
          message="O anúncio será salvo e enviado ao marketplace. Esta ação cria o item real na plataforma."
          onCancel={() => setConfirm(null)}
          onConfirm={() => void publicar(confirm)}
        />
      ) : null}
    </div>
  );
}

/** Linha de uma plataforma no card Publicar: status + checklist + botão. */
function PublishRow({
  label,
  preview,
  busy,
  onPublish,
}: {
  label: string;
  preview: Preview;
  busy: boolean;
  onPublish: () => void;
}) {
  const { connected, alreadyPublished, validation } = preview;
  const canPublish = connected && !alreadyPublished && validation.ok;

  return (
    <div className="space-y-2 rounded-md border border-[var(--border-subtle)] p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-[var(--text-primary)]">{label}</span>
        {alreadyPublished ? (
          <span className="text-xs text-[var(--success)]">Publicado ✓</span>
        ) : !connected ? (
          <span className="text-xs text-[var(--text-tertiary)]">
            Não conectado
          </span>
        ) : validation.ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]">
            <CheckCircle2 className="size-3.5" /> Pronto
          </span>
        ) : (
          <span className="text-xs text-[var(--danger)]">
            {validation.problemas.length} pendência(s)
          </span>
        )}
      </div>

      {connected && !alreadyPublished && !validation.ok ? (
        <ul className="space-y-1">
          {validation.problemas.map((p) => (
            <li
              key={p.campo}
              className="flex items-start gap-1.5 text-xs text-[var(--text-tertiary)]"
            >
              <XCircle className="mt-0.5 size-3 shrink-0 text-[var(--danger)]" />
              {p.mensagem}
            </li>
          ))}
        </ul>
      ) : null}

      {connected && !alreadyPublished ? (
        <Button
          className="w-full"
          disabled={!canPublish || busy}
          onClick={onPublish}
          size="sm"
          type="button"
        >
          {busy ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <Rocket aria-hidden className="size-3.5" />
          )}
          Publicar em {label}
        </Button>
      ) : null}
    </div>
  );
}

/** Dialog de confirmação mínimo (Onda 1 — sem lib de modal). */
function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        <p className="text-sm text-[var(--text-tertiary)]">{message}</p>
        <div className="flex justify-end gap-2">
          <Button
            onClick={onCancel}
            size="sm"
            type="button"
            variant="secondary"
          >
            Cancelar
          </Button>
          <Button onClick={onConfirm} size="sm" type="button">
            Publicar
          </Button>
        </div>
      </div>
    </div>
  );
}
