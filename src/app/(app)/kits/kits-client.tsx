"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ProposalStatus =
  | "proposta"
  | "aprovado"
  | "rejeitado"
  | "bloqueado"
  | "publicado"
  | "erro";

type Proposal = {
  id: string;
  clienteId: string;
  cliente: { id: string; nome: string };
  componentIds: string[];
  components: { id: string; name: string; imageUrl?: string | null; price: number }[];
  reason: string;
  monochromatic: boolean;
  status: ProposalStatus;
  suggestedPrice: number;
  kit: {
    id: string;
    status: string;
    price: number;
    produtoId: string | null;
    categoryPending: boolean;
  } | null;
};

type Classification = {
  produtoId: string;
  gender: "feminino" | "masculino" | "unissex";
  ageBand: "adulto" | "infantil";
  categoryKey: string;
  colorPattern: string | null;
  confidence: number;
  source: string;
  needsReview: boolean;
  produto: {
    id: string;
    nomeOriginal: string;
    cliente: { id: string; nome: string };
  };
};

type ClassificationDraft = Pick<
  Classification,
  "gender" | "ageBand" | "categoryKey" | "colorPattern"
>;

type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

type PublishReport = {
  publicado: number;
  erros: { kitId: string; error: string }[];
};

const statusPresentation: Record<
  ProposalStatus,
  { label: string; tone: NonNullable<BadgeProps["tone"]> }
> = {
  proposta: { label: "Proposta", tone: "info" },
  aprovado: { label: "Aprovado", tone: "success" },
  rejeitado: { label: "Rejeitado", tone: "danger" },
  bloqueado: { label: "Bloqueado", tone: "warning" },
  publicado: { label: "Publicado", tone: "success" },
  erro: { label: "Erro", tone: "danger" },
};

const selectClassName =
  "h-10 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)]";

function formatPrice(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

async function readApi<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiResult<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? "Falha na solicitação" : payload.error);
  }
  return payload.data;
}

function createDraft(classification: Classification): ClassificationDraft {
  return {
    gender: classification.gender,
    ageBand: classification.ageBand,
    categoryKey: classification.categoryKey,
    colorPattern: classification.colorPattern,
  };
}

export function KitsClient() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [classifications, setClassifications] = useState<
    Classification[] | null
  >(null);
  const [priceByProposal, setPriceByProposal] = useState<Record<string, string>>(
    {},
  );
  const [draftByProduct, setDraftByProduct] = useState<
    Record<string, ClassificationDraft>
  >({});
  const [clientFilter, setClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [selectedKitIds, setSelectedKitIds] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishReport, setPublishReport] = useState<PublishReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [proposalResponse, classificationResponse] = await Promise.all([
        fetch("/api/kits/proposals"),
        fetch("/api/kits/classifications"),
      ]);
      const [proposalData, classificationData] = await Promise.all([
        readApi<{ proposals: Proposal[] }>(proposalResponse),
        readApi<{ classifications: Classification[] }>(classificationResponse),
      ]);
      setProposals(proposalData.proposals);
      setClassifications(classificationData.classifications);
      setPriceByProposal((current) => {
        const next = { ...current };
        for (const proposal of proposalData.proposals) {
          next[proposal.id] ??= String(
            proposal.kit?.price ?? proposal.suggestedPrice,
          );
        }
        return next;
      });
      setDraftByProduct((current) => {
        const next = { ...current };
        for (const classification of classificationData.classifications) {
          next[classification.produtoId] ??= createDraft(classification);
        }
        return next;
      });
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar os kits.",
      );
      setProposals([]);
      setClassifications([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const clients = useMemo(() => {
    const byId = new Map<string, string>();
    for (const proposal of proposals ?? []) {
      byId.set(proposal.cliente.id, proposal.cliente.nome);
    }
    for (const classification of classifications ?? []) {
      byId.set(
        classification.produto.cliente.id,
        classification.produto.cliente.nome,
      );
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [classifications, proposals]);

  const visibleProposals = useMemo(
    () =>
      (proposals ?? []).filter(
        (proposal) =>
          (clientFilter === "all" || proposal.clienteId === clientFilter) &&
          (statusFilter === "all" || proposal.status === statusFilter),
      ),
    [clientFilter, proposals, statusFilter],
  );

  const visibleClassifications = useMemo(
    () =>
      (classifications ?? []).filter(
        (classification) =>
          clientFilter === "all" ||
          classification.produto.cliente.id === clientFilter,
      ),
    [classifications, clientFilter],
  );

  async function decide(proposal: Proposal, action: "approve" | "reject") {
    const price = Number(priceByProposal[proposal.id]);
    if (action === "approve" && (!Number.isFinite(price) || price <= 0)) {
      setError("Informe um preço válido antes de aprovar.");
      return;
    }

    setBusyId(proposal.id);
    setError(null);
    setNotice(null);
    try {
      const data = await readApi<{
        kit?: {
          id: string;
          status: ProposalStatus;
          price: number;
          produtoId: string;
          categoryPending: boolean;
        };
        proposal?: { id: string; status: string };
      }>(
        await fetch("/api/kits/proposals", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "approve"
              ? { action, proposalId: proposal.id, price }
              : { action, proposalId: proposal.id },
          ),
        }),
      );
      setProposals((current) =>
        current?.map((item) =>
          item.id === proposal.id
            ? data.kit
              ? { ...item, status: data.kit.status, kit: data.kit }
              : { ...item, status: "rejeitado" }
            : item,
        ) ?? [],
      );
      setNotice(
        action === "approve"
          ? data.kit?.status === "bloqueado"
            ? "Kit aprovado, mas bloqueado por estoque insuficiente."
            : "Kit aprovado e pronto para publicação."
          : "Proposta rejeitada e removida das próximas gerações.",
      );
    } catch (decisionError: unknown) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : "Não foi possível atualizar a proposta.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function saveManual(classification: Classification) {
    const draft = draftByProduct[classification.produtoId];
    if (!draft?.categoryKey.trim()) {
      setError("Informe a categoria antes de salvar.");
      return;
    }

    setBusyId(classification.produtoId);
    setError(null);
    setNotice(null);
    try {
      await readApi<{ classification: Classification }>(
        await fetch("/api/kits/classifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            produtoId: classification.produtoId,
            gender: draft.gender,
            ageBand: draft.ageBand,
            categoryKey: draft.categoryKey,
            colorPattern: draft.colorPattern,
          }),
        }),
      );
      setClassifications((current) =>
        current?.filter(
          (item) => item.produtoId !== classification.produtoId,
        ) ?? [],
      );
      setNotice("Classificação manual salva e protegida de reprocessamentos.");
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível salvar a classificação.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function classifyPending() {
    setClassifying(true);
    setError(null);
    setNotice(null);
    try {
      const data = await readApi<{
        processed: number;
        needsReview: number;
        failures: number;
      }>(
        await fetch("/api/kits/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 50 }),
        }),
      );
      setNotice(
        `${data.processed} processados, ${data.needsReview} para revisão, ${data.failures} falhas.`,
      );
      await load();
    } catch (classifyError: unknown) {
      setError(
        classifyError instanceof Error
          ? classifyError.message
          : "Não foi possível classificar os produtos.",
      );
    } finally {
      setClassifying(false);
    }
  }

  async function publishSelected() {
    if (selectedKitIds.length === 0) return;

    setPublishing(true);
    setError(null);
    setNotice(null);
    setPublishReport(null);
    try {
      const data = await readApi<PublishReport>(
        await fetch("/api/kits/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kitIds: selectedKitIds }),
        }),
      );
      const errorByKit = new Map(
        data.erros.map((publishError) => [publishError.kitId, publishError.error]),
      );
      setProposals((current) =>
        current?.map((proposal) => {
          if (!proposal.kit || !selectedKitIds.includes(proposal.kit.id)) {
            return proposal;
          }
          const publishError = errorByKit.get(proposal.kit.id);
          const status: ProposalStatus = publishError
            ? publishError === "Estoque insuficiente."
              ? "bloqueado"
              : "erro"
            : "publicado";
          return {
            ...proposal,
            status,
            kit: { ...proposal.kit, status },
          };
        }) ?? [],
      );
      setPublishReport(data);
      setSelectedKitIds([]);
    } catch (publishError: unknown) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "Não foi possível publicar os kits selecionados.",
      );
    } finally {
      setPublishing(false);
    }
  }

  function toggleKitSelection(kitId: string) {
    setSelectedKitIds((current) =>
      current.includes(kitId)
        ? current.filter((selectedId) => selectedId !== kitId)
        : [...current, kitId],
    );
  }

  function updateDraft(
    produtoId: string,
    field: keyof ClassificationDraft,
    value: string,
  ) {
    setDraftByProduct((current) => ({
      ...current,
      [produtoId]: {
        ...current[produtoId]!,
        [field]: field === "colorPattern" && value === "" ? null : value,
      },
    }));
  }

  const loading = proposals === null || classifications === null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Gerador de kits
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
            Revise combinações compatíveis, defina o preço final e mantenha a
            decisão humana antes de qualquer publicação.
          </p>
        </div>
        <Button onClick={classifyPending} disabled={classifying}>
          {classifying ? "Classificando…" : "Classificar pendentes"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 border-y border-[var(--border-subtle)] py-4">
        <label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          Filtrar por cliente
          <select
            aria-label="Filtrar por cliente"
            className={selectClassName}
            value={clientFilter}
            onChange={(event) => setClientFilter(event.target.value)}
          >
            <option value="all">Todos os clientes</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          Filtrar por status
          <select
            aria-label="Filtrar por status"
            className={selectClassName}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">Todos os status</option>
            {Object.entries(statusPresentation).map(([value, presentation]) => (
              <option key={value} value={value}>
                {presentation.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={load}>
            Tentar novamente
          </Button>
        </div>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-[var(--radius-lg)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]"
        >
          {notice}
        </p>
      ) : null}

      <section aria-labelledby="manual-review-title" className="space-y-4">
        <div>
          <h2
            id="manual-review-title"
            className="text-base font-semibold text-[var(--text-primary)]"
          >
            Revisão manual
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Itens com confiança abaixo de 70% ficam fora dos cruzamentos até a
            confirmação.
          </p>
        </div>

        {loading ? (
          <div className="h-28 animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-elevated)]" />
        ) : visibleClassifications.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] px-5 py-8 text-center text-sm text-[var(--text-secondary)]">
            Fila de revisão vazia.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            {visibleClassifications.map((classification) => {
              const draft =
                draftByProduct[classification.produtoId] ??
                createDraft(classification);
              return (
                <li key={classification.produtoId} className="p-4 sm:p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--text-primary)]">
                        {classification.produto.nomeOriginal}
                      </p>
                      <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                        {classification.produto.cliente.nome} · confiança{" "}
                        {Math.round(classification.confidence * 100)}%
                      </p>
                    </div>
                    <Badge tone="warning">Revisão necessária</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="grid gap-2 text-xs font-medium text-[var(--text-secondary)]">
                      Gênero
                      <select
                        aria-label={`Gênero ${classification.produtoId}`}
                        className={selectClassName}
                        value={draft.gender}
                        onChange={(event) =>
                          updateDraft(
                            classification.produtoId,
                            "gender",
                            event.target.value,
                          )
                        }
                      >
                        <option value="feminino">Feminino</option>
                        <option value="masculino">Masculino</option>
                        <option value="unissex">Unissex</option>
                      </select>
                    </label>
                    <label className="grid gap-2 text-xs font-medium text-[var(--text-secondary)]">
                      Faixa etária
                      <select
                        aria-label={`Faixa etária ${classification.produtoId}`}
                        className={selectClassName}
                        value={draft.ageBand}
                        onChange={(event) =>
                          updateDraft(
                            classification.produtoId,
                            "ageBand",
                            event.target.value,
                          )
                        }
                      >
                        <option value="adulto">Adulto</option>
                        <option value="infantil">Infantil</option>
                      </select>
                    </label>
                    <Input
                      label="Categoria"
                      aria-label={`Categoria ${classification.produtoId}`}
                      value={draft.categoryKey}
                      onChange={(event) =>
                        updateDraft(
                          classification.produtoId,
                          "categoryKey",
                          event.target.value,
                        )
                      }
                    />
                    <Input
                      label="Cor/padrão"
                      aria-label={`Cor/padrão ${classification.produtoId}`}
                      value={draft.colorPattern ?? ""}
                      onChange={(event) =>
                        updateDraft(
                          classification.produtoId,
                          "colorPattern",
                          event.target.value,
                        )
                      }
                    />
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => saveManual(classification)}
                      disabled={busyId === classification.produtoId}
                    >
                      {busyId === classification.produtoId
                        ? "Salvando…"
                        : "Salvar manualmente"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="kit-list-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="kit-list-title"
              className="text-base font-semibold text-[var(--text-primary)]"
            >
              Propostas e kits
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Compatibilidade, motivo e preço reunidos para uma decisão rápida.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-tertiary)] [font-variant-numeric:tabular-nums]">
              {formatCount(
                selectedKitIds.length,
                "selecionado",
                "selecionados",
              )}
            </span>
            <Button
              size="sm"
              onClick={publishSelected}
              disabled={selectedKitIds.length === 0 || publishing}
            >
              {publishing ? "Publicando…" : "Publicar selecionados"}
            </Button>
          </div>
        </div>

        {publishReport ? (
          <div
            role="status"
            aria-label="Relatório de publicação"
            className="rounded-[var(--radius-lg)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-primary)]"
          >
            <p>
              {formatCount(publishReport.publicado, "publicado", "publicados")},{" "}
              {formatCount(publishReport.erros.length, "erro", "erros")}.
            </p>
            {publishReport.erros.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[var(--danger)]">
                {publishReport.erros.map((publishError) => (
                  <li key={publishError.kitId}>
                    {publishError.kitId}: {publishError.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="h-32 animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-elevated)]"
              />
            ))}
          </div>
        ) : visibleProposals.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] px-6 py-12 text-center">
            <p className="font-semibold text-[var(--text-primary)]">
              Nenhum kit encontrado.
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-[var(--text-secondary)]">
              Ajuste os filtros ou classifique os produtos pendentes para gerar
              novas combinações.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            {visibleProposals.map((proposal) => {
              const presentation = statusPresentation[proposal.status];
              const canPublish =
                proposal.status === "aprovado" &&
                Boolean(proposal.kit?.produtoId) &&
                !proposal.kit?.categoryPending;
              return (
                <li key={proposal.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={presentation.tone}>
                          {presentation.label}
                        </Badge>
                        <span className="text-xs text-[var(--text-tertiary)]">
                          {proposal.cliente.nome}
                        </span>
                        {proposal.monochromatic ? (
                          <Badge tone="warning">Mesma cor</Badge>
                        ) : null}
                      </div>
                      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--text-primary)]">
                        {proposal.components.map((component) => (
                          <li key={component.id}>
                            {component.name}{" "}
                            <span className="text-[var(--text-secondary)] [font-variant-numeric:tabular-nums]">
                              {formatPrice(component.price)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                        {proposal.reason}
                      </p>
                    </div>

                    <div className="w-full space-y-3 sm:w-56">
                      {canPublish && proposal.kit ? (
                        <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                          <input
                            type="checkbox"
                            aria-label={`Selecionar kit ${proposal.kit.id}`}
                            checked={selectedKitIds.includes(proposal.kit.id)}
                            disabled={publishing}
                            onChange={() => toggleKitSelection(proposal.kit!.id)}
                            className="size-4 accent-[var(--w3-red)]"
                          />
                          Selecionar para publicar
                        </label>
                      ) : null}
                      <Input
                        label={
                          proposal.status === "proposta"
                            ? "Preço final"
                            : "Preço do kit"
                        }
                        aria-label={`Preço do kit ${proposal.id}`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        disabled={proposal.status !== "proposta"}
                        value={priceByProposal[proposal.id] ?? ""}
                        onChange={(event) =>
                          setPriceByProposal((current) => ({
                            ...current,
                            [proposal.id]: event.target.value,
                          }))
                        }
                      />
                      {proposal.status === "proposta" ? (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            onClick={() => decide(proposal, "approve")}
                            disabled={busyId === proposal.id}
                          >
                            Aprovar
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => decide(proposal, "reject")}
                            disabled={busyId === proposal.id}
                          >
                            Rejeitar
                          </Button>
                        </div>
                      ) : proposal.kit?.produtoId ? (
                        <div className="space-y-2">
                          {proposal.kit.categoryPending ? (
                            <Badge tone="warning">Categoria pendente</Badge>
                          ) : null}
                          <Button asChild size="sm" variant="secondary">
                            <Link
                              href={`/produtos/${proposal.kit.produtoId}/editar`}
                            >
                              Revisar anúncio
                            </Link>
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
