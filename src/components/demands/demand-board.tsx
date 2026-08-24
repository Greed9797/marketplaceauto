"use client";

import {
  CheckCircle2,
  CirclePause,
  CirclePlay,
  Clock3,
  Plus,
  RotateCcw,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";

import {
  completeDemandTimerAction,
  createDemandTaskAction,
  pauseDemandTimerAction,
  resumeDemandTimerAction,
  startDemandTimerAction,
} from "@/app/(app)/demandas/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

type TaskStatus = "TODO" | "RUNNING" | "PAUSED" | "DONE";

type BoardData = {
  workspace: { id: string; name: string };
  currentUserId: string;
  canManage: boolean;
  categories: Array<{
    id: string;
    name: string;
    targetMinutes: number;
    color: string;
    active: boolean;
    position: number;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    status: TaskStatus;
    accumulatedSeconds: number;
    runningSince: string | null;
    pausedAt: string | null;
    completedAt: string | null;
    category: { id: string; name: string; targetMinutes: number; color: string };
    assignee: { id: string; name: string | null; email: string; image: string | null };
  }>;
  members: Array<{
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    role: string;
  }>;
};

const columns: Array<{ status: TaskStatus; title: string; description: string }> = [
  { status: "TODO", title: "A fazer", description: "Aguardando início" },
  { status: "RUNNING", title: "Em andamento", description: "Timer ativo" },
  { status: "PAUSED", title: "Pausadas", description: "Tempo preservado" },
  { status: "DONE", title: "Concluídas", description: "Histórico final" },
];

const selectClassName =
  "h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)]";

const textareaClassName =
  "min-h-24 w-full resize-y rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)]";

function elapsedSeconds(task: BoardData["tasks"][number], nowMs: number) {
  if (task.status !== "RUNNING" || !task.runningSince || nowMs === 0) {
    return Math.max(0, task.accumulatedSeconds);
  }
  const segment = Math.max(0, Math.floor((nowMs - new Date(task.runningSince).getTime()) / 1000));
  return Math.max(0, task.accumulatedSeconds) + segment;
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

function initials(name: string | null, email: string) {
  const source = name?.trim() || email;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function TaskCard({
  task,
  nowMs,
  busy,
  onTimer,
}: {
  task: BoardData["tasks"][number];
  nowMs: number;
  busy: boolean;
  onTimer: (operation: "start" | "pause" | "resume" | "complete", taskId: string) => void;
}) {
  const elapsed = elapsedSeconds(task, nowMs);
  const targetSeconds = task.category.targetMinutes * 60;
  const progress = targetSeconds > 0 ? (elapsed / targetSeconds) * 100 : 0;
  const severity = progress >= 200 ? "critical" : progress >= 150 ? "warning" : "normal";

  return (
    <article
      className="rounded-md border border-[var(--border-subtle)] border-l-[3px] bg-[var(--bg-surface)] p-4 shadow-sm"
      style={{ borderLeftColor: task.category.color }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--text-tertiary)]">{task.category.name}</p>
          <h3 className="mt-1 break-words text-sm font-semibold text-[var(--text-primary)]">
            {task.title}
          </h3>
        </div>
        {severity !== "normal" ? (
          <Badge tone={severity === "critical" ? "danger" : "warning"}>
            {severity === "critical" ? "+100%" : "+50%"}
          </Badge>
        ) : null}
      </div>

      {task.description ? (
        <p className="mt-2 line-clamp-3 text-sm leading-5 text-[var(--text-secondary)]">
          {task.description}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
        <span className="grid size-7 place-items-center rounded-full bg-[var(--bg-elevated)] text-[0.65rem] font-semibold text-[var(--text-secondary)]">
          {initials(task.assignee.name, task.assignee.email)}
        </span>
        <span className="min-w-0 truncate">{task.assignee.name || task.assignee.email}</span>
      </div>

      <div
        className={cn(
          "mt-4 rounded-md border px-3 py-2.5",
          severity === "critical"
            ? "border-[var(--danger)] bg-[var(--danger-bg)]"
            : severity === "warning"
              ? "border-amber-400/60 bg-amber-500/10"
              : "border-[var(--border-subtle)] bg-[var(--bg-elevated)]",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
            <Clock3 aria-hidden className="size-3.5" /> Meta {task.category.targetMinutes} min
          </span>
          <span
            className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]"
            suppressHydrationWarning
          >
            {formatDuration(elapsed)}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {task.status === "TODO" ? (
          <Button disabled={busy} onClick={() => onTimer("start", task.id)} size="sm" type="button">
            <CirclePlay aria-hidden className="size-4" /> Iniciar
          </Button>
        ) : null}
        {task.status === "RUNNING" ? (
          <>
            <Button
              disabled={busy}
              onClick={() => onTimer("pause", task.id)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <CirclePause aria-hidden className="size-4" /> Pausar
            </Button>
            <Button
              disabled={busy}
              onClick={() => onTimer("complete", task.id)}
              size="sm"
              type="button"
            >
              <CheckCircle2 aria-hidden className="size-4" /> Concluir
            </Button>
          </>
        ) : null}
        {task.status === "PAUSED" ? (
          <Button disabled={busy} onClick={() => onTimer("resume", task.id)} size="sm" type="button">
            <RotateCcw aria-hidden className="size-4" /> Retomar
          </Button>
        ) : null}
        {task.status === "DONE" ? (
          <span className="flex min-h-9 items-center gap-1.5 text-xs font-semibold text-emerald-600">
            <CheckCircle2 aria-hidden className="size-4" /> Finalizada
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function DemandBoard({ initialData }: { initialData: BoardData }) {
  const router = useRouter();
  const [nowMs, setNowMs] = useState(0);
  const [tasks, setTasks] = useState(initialData.tasks);
  const [creating, setCreating] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setTasks(initialData.tasks);
  }, [initialData.tasks]);

  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (assigneeFilter === "all" || task.assignee.id === assigneeFilter) &&
          (categoryFilter === "all" || task.category.id === categoryFilter),
      ),
    [assigneeFilter, categoryFilter, tasks],
  );

  function applyLocalTimer(
    operation: "start" | "pause" | "resume" | "complete",
    taskId: string,
  ) {
    const changedAt = Date.now();
    const changedAtIso = new Date(changedAt).toISOString();
    setNowMs(changedAt);
    setTasks((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task;
        if (operation === "start") {
          return { ...task, status: "RUNNING", runningSince: changedAtIso, pausedAt: null };
        }
        if (operation === "pause") {
          return {
            ...task,
            status: "PAUSED",
            accumulatedSeconds: elapsedSeconds(task, changedAt),
            runningSince: null,
            pausedAt: changedAtIso,
          };
        }
        if (operation === "resume") {
          return { ...task, status: "RUNNING", runningSince: changedAtIso, pausedAt: null };
        }
        return {
          ...task,
          status: "DONE",
          accumulatedSeconds: elapsedSeconds(task, changedAt),
          runningSince: null,
          pausedAt: null,
          completedAt: changedAtIso,
        };
      }),
    );
  }

  function handleTimer(operation: "start" | "pause" | "resume" | "complete", taskId: string) {
    const action = {
      start: startDemandTimerAction,
      pause: pauseDemandTimerAction,
      resume: resumeDemandTimerAction,
      complete: completeDemandTimerAction,
    }[operation];
    setBusyTaskId(taskId);
    setMessage(null);
    startTransition(async () => {
      const result = await action(taskId);
      if (!result.ok) setMessage({ tone: "error", text: result.error });
      else {
        applyLocalTimer(operation, taskId);
        router.refresh();
      }
      setBusyTaskId(null);
    });
  }

  function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setMessage(null);
    startTransition(async () => {
      const result = await createDemandTaskAction({
        title: data.get("title"),
        description: data.get("description") || undefined,
        categoryId: data.get("categoryId"),
        assigneeId: initialData.canManage ? data.get("assigneeId") : initialData.currentUserId,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      form.reset();
      setCreating(false);
      setMessage({ tone: "success", text: "Demanda cadastrada." });
      router.refresh();
    });
  }

  const activeCategories = initialData.categories.filter((category) => category.active);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--w3-red)]">
            Operação · {initialData.workspace.name}
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
            Kanban de demandas
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
            Cada cartão guarda seu próprio relógio. Pausas persistem e os alertas seguem a meta da categoria.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {initialData.canManage ? (
            <Button asChild variant="secondary">
              <Link href="/demandas/configuracoes">
                <Settings2 aria-hidden className="size-4" /> Configurar
              </Link>
            </Button>
          ) : null}
          <Button onClick={() => setCreating((value) => !value)} type="button">
            {creating ? <X aria-hidden className="size-4" /> : <Plus aria-hidden className="size-4" />}
            {creating ? "Fechar" : "Nova demanda"}
          </Button>
        </div>
      </header>

      {message ? (
        <p
          aria-live="polite"
          className={cn(
            "rounded-md border px-4 py-3 text-sm",
            message.tone === "error"
              ? "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
          )}
        >
          {message.text}
        </p>
      ) : null}

      {creating ? (
        <section className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Cadastrar demanda</h2>
            <p className="mt-1 text-sm text-[var(--text-tertiary)]">
              O timer começa somente quando o responsável clicar em iniciar.
            </p>
          </div>
          {activeCategories.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">
              Nenhuma categoria ativa. {initialData.canManage ? "Crie uma na configuração de demandas." : "Peça ao gestor para cadastrar uma categoria."}
            </p>
          ) : (
            <form className="grid gap-4 lg:grid-cols-2" onSubmit={createTask}>
              <Input label="Título" maxLength={140} minLength={3} name="title" placeholder="Ex.: Melhorar os anúncios" required />
              <label className="grid gap-2 text-[var(--text-primary)]">
                <span className="text-caption text-[var(--text-tertiary)]">Categoria</span>
                <select className={selectClassName} name="categoryId" required>
                  <option value="">Selecione</option>
                  {activeCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name} · meta {category.targetMinutes} min
                    </option>
                  ))}
                </select>
              </label>
              {initialData.canManage ? (
                <label className="grid gap-2 text-[var(--text-primary)]">
                  <span className="text-caption text-[var(--text-tertiary)]">Responsável</span>
                  <select className={selectClassName} defaultValue={initialData.currentUserId} name="assigneeId" required>
                    {initialData.members.map((member) => (
                      <option key={member.id} value={member.id}>{member.name || member.email}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="flex items-end gap-2 rounded-md bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                  <UserRound aria-hidden className="size-4" /> A demanda será atribuída a você.
                </div>
              )}
              <label className="grid gap-2 lg:col-span-2">
                <span className="text-caption text-[var(--text-tertiary)]">Descrição opcional</span>
                <textarea className={textareaClassName} maxLength={1200} name="description" placeholder="Contexto, entregáveis ou observações" />
              </label>
              <div className="lg:col-span-2">
                <Button disabled={pending} type="submit">{pending ? "Salvando..." : "Salvar demanda"}</Button>
              </div>
            </form>
          )}
        </section>
      ) : null}

      <div className="flex flex-col gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:flex-row sm:items-end">
        {initialData.canManage ? (
          <label className="grid min-w-52 gap-2">
            <span className="text-caption text-[var(--text-tertiary)]">Responsável</span>
            <select className={selectClassName} onChange={(event) => setAssigneeFilter(event.target.value)} value={assigneeFilter}>
              <option value="all">Todos os responsáveis</option>
              {initialData.members.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}
            </select>
          </label>
        ) : null}
        <label className="grid min-w-52 gap-2">
          <span className="text-caption text-[var(--text-tertiary)]">Categoria</span>
          <select className={selectClassName} onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
            <option value="all">Todas as categorias</option>
            {initialData.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1120px] grid-cols-4 gap-4">
          {columns.map((column) => {
            const tasks = visibleTasks.filter((task) => task.status === column.status);
            return (
              <section className="rounded-md bg-[var(--bg-elevated)] p-3" key={column.status}>
                <header className="mb-3 flex items-start justify-between gap-3 px-1 py-1">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">{column.title}</h2>
                    <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">{column.description}</p>
                  </div>
                  <span className="grid size-7 place-items-center rounded-full bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-secondary)]">{tasks.length}</span>
                </header>
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <TaskCard busy={pending && busyTaskId === task.id} key={task.id} nowMs={nowMs} onTimer={handleTimer} task={task} />
                  ))}
                  {tasks.length === 0 ? (
                    <div className="rounded-md border border-dashed border-[var(--border-strong)] px-4 py-8 text-center text-xs text-[var(--text-tertiary)]">Nenhuma demanda aqui.</div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
