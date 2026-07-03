"use client";

import { Check, Loader2, Send, Sparkles, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

type Proposal = { name: string; args: Record<string, unknown> };

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  proposals?: Proposal[];
  /** Estado de aplicação de cada proposta (por índice). */
  applied?: Record<number, { ok: boolean; text: string }>;
};

/** Extrai o produtoId da URL /produtos/<id>/... quando o usuário está nela. */
function useProdutoId(): string | null {
  const pathname = usePathname();
  return useMemo(() => {
    const m = /\/produtos\/([^/]+)/.exec(pathname ?? "");
    return m?.[1] ?? null;
  }, [pathname]);
}

function proposalLabel(p: Proposal): string {
  if (typeof p.args.resumo === "string" && p.args.resumo.trim()) {
    return p.args.resumo;
  }
  if (p.name === "publicar") {
    return `Publicar em ${p.args.plataforma === "shopee" ? "Shopee" : "Mercado Livre"}`;
  }
  return "Aplicar alteração sugerida";
}

/**
 * Copiloto-chat com MiniMax M3 (Onda 3+). O usuário conversa ("melhora o
 * título", "adiciona o que falta pra Shopee"); o M3 responde e PROPÕE ações;
 * o usuário aprova e o app finaliza (dispara /api/copilot/apply). Multimodal:
 * o backend manda as imagens do produto pro M3.
 */
export function CopilotFab() {
  const router = useRouter();
  const produtoId = useProdutoId();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToEnd() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }

  async function enviar() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const history: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(history);
    setSending(true);
    scrollToEnd();
    try {
      const response = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          produtoId,
          messages: history.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        data?: { content: string; proposals: Proposal[] };
      } | null;
      if (!response.ok || !data?.success || !data.data) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data?.error ?? "Não consegui responder agora.",
          },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            data.data!.content ||
            (data.data!.proposals.length
              ? "Preparei uma sugestão — revise e aplique:"
              : "…"),
          proposals: data.data!.proposals,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Falha ao falar com o copiloto." },
      ]);
    } finally {
      setSending(false);
      scrollToEnd();
    }
  }

  async function aplicar(msgIndex: number, propIndex: number, p: Proposal) {
    const key = `${msgIndex}:${propIndex}`;
    setApplyingKey(key);
    try {
      const response = await fetch("/api/copilot/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId, name: p.name, args: p.args }),
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        data?: { message: string };
      } | null;
      const ok = Boolean(response.ok && data?.success);
      setMessages((prev) =>
        prev.map((m, i) =>
          i === msgIndex
            ? {
                ...m,
                applied: {
                  ...m.applied,
                  [propIndex]: {
                    ok,
                    text:
                      data?.data?.message ??
                      data?.error ??
                      (ok ? "Feito." : "Falhou."),
                  },
                },
              }
            : m,
        ),
      );
      if (ok) router.refresh();
    } catch {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === msgIndex
            ? {
                ...m,
                applied: {
                  ...m.applied,
                  [propIndex]: { ok: false, text: "Falha ao aplicar." },
                },
              }
            : m,
        ),
      );
    } finally {
      setApplyingKey(null);
    }
  }

  return (
    <>
      <button
        aria-label="Abrir copiloto"
        className="fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-[var(--w3-red)] text-white shadow-lg transition-transform hover:scale-105"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {open ? <X className="size-6" /> : <Sparkles className="size-6" />}
      </button>

      {open ? (
        <div className="fixed bottom-24 right-5 z-40 flex max-h-[75vh] w-[min(94vw,28rem)] flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-[var(--w3-red)]" />
              <span className="font-semibold text-[var(--text-primary)]">
                Copiloto
              </span>
              <span className="text-[0.65rem] text-[var(--text-tertiary)]">
                MiniMax M3
              </span>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="space-y-2 text-sm text-[var(--text-tertiary)]">
                <p>
                  Oi! Posso melhorar títulos, preencher o que falta e publicar.
                </p>
                <p className="text-xs">
                  {produtoId
                    ? "Produto em foco detectado. Tente: “melhora o título e adiciona o que falta pra Shopee”."
                    : "Abra um produto na tela de otimização para eu agir sobre ele."}
                </p>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className="space-y-2">
                  <div
                    className={
                      m.role === "user"
                        ? "ml-auto w-fit max-w-[85%] rounded-lg bg-[var(--w3-red)] px-3 py-2 text-sm text-white"
                        : "w-fit max-w-[90%] rounded-lg bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
                    }
                  >
                    {m.content}
                  </div>
                  {m.proposals?.map((p, pi) => {
                    const applied = m.applied?.[pi];
                    return (
                      <div
                        key={pi}
                        className="space-y-1.5 rounded-lg border border-[var(--border-strong)] p-3"
                      >
                        <p className="text-xs font-medium text-[var(--text-primary)]">
                          {proposalLabel(p)}
                        </p>
                        {applied ? (
                          <p
                            className={
                              applied.ok
                                ? "flex items-center gap-1 text-xs text-[var(--success)]"
                                : "text-xs text-[var(--danger)]"
                            }
                          >
                            {applied.ok ? <Check className="size-3" /> : null}
                            {applied.text}
                          </p>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--w3-red)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
                              disabled={applyingKey !== null || !produtoId}
                              onClick={() => void aplicar(i, pi, p)}
                              type="button"
                            >
                              {applyingKey === `${i}:${pi}` ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Check className="size-3" />
                              )}
                              Aprovar e aplicar
                            </button>
                            <button
                              className="rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-xs text-[var(--text-tertiary)]"
                              onClick={() =>
                                setMessages((prev) =>
                                  prev.map((mm, mi) =>
                                    mi === i
                                      ? {
                                          ...mm,
                                          applied: {
                                            ...mm.applied,
                                            [pi]: {
                                              ok: false,
                                              text: "Recusado.",
                                            },
                                          },
                                        }
                                      : mm,
                                  ),
                                )
                              }
                              type="button"
                            >
                              Recusar
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
            {sending ? (
              <p className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                <Loader2 className="size-3 animate-spin" /> Pensando…
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] p-3">
            <input
              className="h-10 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--w3-red)]"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              placeholder="Peça uma melhoria…"
              value={input}
            />
            <button
              aria-label="Enviar"
              className="grid size-10 place-items-center rounded-md bg-[var(--w3-red)] text-white disabled:opacity-60"
              disabled={sending || !input.trim()}
              onClick={() => void enviar()}
              type="button"
            >
              <Send className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
