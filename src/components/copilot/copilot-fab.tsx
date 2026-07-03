"use client";

import {
  AlertTriangle,
  Check,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type CopilotAction =
  | { kind: "post"; endpoint: string; label: string }
  | { kind: "link"; href: string; label: string };

type CopilotIssue = {
  id: string;
  severity: "error" | "warning";
  title: string;
  action: string;
  detail: string;
  actions: CopilotAction[];
};

/**
 * Copiloto "bolinha" (Onda 3) — Motor de Alterações no modo sugere→aprova.
 * FAB global: diagnostica os erros do workspace e, para cada um, propõe uma
 * ação de conserto que o usuário aplica com um clique (dispara a rota existente).
 * Nunca age sozinho; nada fora das ações que o diagnóstico propôs.
 */
export function CopilotFab() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<CopilotIssue[] | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    id: string;
    ok: boolean;
    text: string;
  } | null>(null);

  const diagnosticar = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/copilot/diagnose");
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: { issues: CopilotIssue[] };
      } | null;
      setIssues(response.ok && data?.success ? data.data!.issues : []);
    } catch {
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && issues === null) void diagnosticar();
  }, [open, issues, diagnosticar]);

  async function aplicar(issueId: string, endpoint: string) {
    setApplying(endpoint);
    setFeedback(null);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        ok?: boolean;
        error?: string;
      } | null;
      const ok = response.ok && (data?.success ?? data?.ok ?? false);
      setFeedback({
        id: issueId,
        ok,
        text: ok
          ? "Feito. Reavaliando…"
          : (data?.error ?? "Não foi possível aplicar."),
      });
      if (ok) await diagnosticar();
    } catch {
      setFeedback({ id: issueId, ok: false, text: "Falha ao aplicar." });
    } finally {
      setApplying(null);
    }
  }

  const problemCount = issues?.length ?? 0;

  return (
    <>
      {/* Bolinha */}
      <button
        aria-label="Abrir copiloto"
        className="fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-[var(--w3-red)] text-white shadow-lg transition-transform hover:scale-105"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {open ? (
          <X className="size-6" />
        ) : (
          <Sparkles className="size-6" />
        )}
        {!open && problemCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-white text-[0.7rem] font-bold text-[var(--w3-red)]">
            {problemCount}
          </span>
        ) : null}
      </button>

      {/* Painel */}
      {open ? (
        <div className="fixed bottom-24 right-5 z-40 flex max-h-[70vh] w-[min(92vw,26rem)] flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-[var(--w3-red)]" />
              <span className="font-semibold text-[var(--text-primary)]">
                Copiloto
              </span>
            </div>
            <button
              className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              disabled={loading}
              onClick={() => void diagnosticar()}
              type="button"
            >
              {loading ? "Analisando…" : "Reanalisar"}
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {loading && issues === null ? (
              <p className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
                <Loader2 className="size-4 animate-spin" /> Analisando o
                workspace…
              </p>
            ) : problemCount === 0 ? (
              <p className="flex items-center gap-2 text-sm text-[var(--success)]">
                <Check className="size-4" /> Nenhum problema encontrado. Tudo em
                ordem.
              </p>
            ) : (
              issues!.map((issue) => (
                <div
                  key={issue.id}
                  className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      className={
                        issue.severity === "error"
                          ? "mt-0.5 size-4 shrink-0 text-[var(--danger)]"
                          : "mt-0.5 size-4 shrink-0 text-[var(--warning)]"
                      }
                    />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {issue.title}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        {issue.action}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {issue.actions.map((a) =>
                      a.kind === "post" ? (
                        <button
                          key={a.endpoint}
                          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--w3-red)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
                          disabled={applying !== null}
                          onClick={() => void aplicar(issue.id, a.endpoint)}
                          type="button"
                        >
                          {applying === a.endpoint ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Sparkles className="size-3" />
                          )}
                          {a.label}
                        </button>
                      ) : (
                        <Link
                          key={a.href}
                          className="inline-flex items-center rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--w3-red)]"
                          href={a.href}
                          onClick={() => setOpen(false)}
                        >
                          {a.label}
                        </Link>
                      ),
                    )}
                  </div>

                  {feedback && feedback.id === issue.id ? (
                    <p
                      className={
                        feedback.ok
                          ? "text-xs text-[var(--success)]"
                          : "text-xs text-[var(--danger)]"
                      }
                    >
                      {feedback.text}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
