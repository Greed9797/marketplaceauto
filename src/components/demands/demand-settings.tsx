"use client";

import { ArrowLeft, BellRing, Clock3, Plus, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import {
  createDemandCategoryAction,
  saveDemandMemberProfileAction,
  saveDemandNotificationConfigAction,
} from "@/app/(app)/demandas/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

type SettingsData = {
  workspace: { id: string; name: string };
  categories: Array<{ id: string; name: string; targetMinutes: number; color: string; active: boolean }>;
  members: Array<{ id: string; name: string | null; email: string; role: string }>;
  profiles: Array<{ userId: string; leaderUserId: string | null; mcrmConversationId: string | null }>;
  notification: {
    enabled: boolean;
    mcrmBaseUrl: string | null;
    tokenConfigured: boolean;
    generalGroupConversationId: string | null;
  } | null;
};

const selectClassName =
  "h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)]";

export function DemandSettings({ initialData }: { initialData: SettingsData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage({ tone: "error", text: result.error });
      else {
        setMessage({ tone: "success", text: success });
        router.refresh();
      }
    });
  }

  function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    run(
      () =>
        createDemandCategoryAction({
          name: data.get("name"),
          targetMinutes: data.get("targetMinutes"),
          color: data.get("color"),
        }),
      "Categoria criada.",
    );
  }

  function saveNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nullable = (name: string) => String(data.get(name) ?? "").trim() || null;
    run(
      () =>
        saveDemandNotificationConfigAction({
          enabled: data.get("enabled") === "on",
          mcrmBaseUrl: nullable("mcrmBaseUrl"),
          mcrmToken: nullable("mcrmToken"),
          generalGroupConversationId: nullable("generalGroupConversationId"),
        }),
      "Integração do MCRM atualizada.",
    );
  }

  function saveMember(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(
      () =>
        saveDemandMemberProfileAction({
          userId,
          leaderUserId: String(data.get("leaderUserId") ?? "") || null,
          mcrmConversationId: String(data.get("mcrmConversationId") ?? "").trim() || null,
        }),
      "Destinatário atualizado.",
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Button asChild className="-ml-3 mb-2" size="sm" variant="ghost">
            <Link href="/demandas"><ArrowLeft aria-hidden className="size-4" /> Voltar ao Kanban</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">Configurar demandas</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Metas, hierarquia e destinos do WhatsApp para {initialData.workspace.name}.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
          <ShieldCheck aria-hidden className="size-4 text-emerald-600" /> Bearer protegido no Supabase Vault
        </div>
      </header>

      {message ? (
        <p aria-live="polite" className={cn("rounded-md border px-4 py-3 text-sm", message.tone === "error" ? "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700")}>{message.text}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="hover:shadow-sm">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-[var(--w3-red-bg)] text-[var(--w3-red)]"><Clock3 aria-hidden className="size-4" /></span>
            <div><h2 className="font-semibold text-[var(--text-primary)]">Categorias e metas</h2><p className="mt-1 text-sm text-[var(--text-tertiary)]">O alerta usa a meta selecionada no cartão.</p></div>
          </div>
          <form className="grid gap-4 sm:grid-cols-[1fr_8rem_5rem]" onSubmit={createCategory}>
            <Input label="Nome" name="name" placeholder="Ex.: Melhorar Ads" required />
            <Input label="Meta (min)" max={1440} min={1} name="targetMinutes" type="number" defaultValue={30} required />
            <Input aria-label="Cor da categoria" className="p-1" label="Cor" name="color" type="color" defaultValue="#D90429" required />
            <Button className="sm:col-span-3" disabled={pending} type="submit"><Plus aria-hidden className="size-4" /> Adicionar categoria</Button>
          </form>
          <div className="mt-5 divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
            {initialData.categories.map((category) => (
              <div className="flex items-center justify-between gap-3 py-3" key={category.id}>
                <div className="flex min-w-0 items-center gap-3"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: category.color }} /><span className="truncate text-sm font-medium text-[var(--text-primary)]">{category.name}</span></div>
                <span className="text-xs text-[var(--text-tertiary)]">{category.targetMinutes} min</span>
              </div>
            ))}
            {initialData.categories.length === 0 ? <p className="py-5 text-sm text-[var(--text-tertiary)]">Nenhuma categoria cadastrada.</p> : null}
          </div>
        </Card>

        <Card className="hover:shadow-sm">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-[var(--w3-red-bg)] text-[var(--w3-red)]"><BellRing aria-hidden className="size-4" /></span>
            <div><h2 className="font-semibold text-[var(--text-primary)]">MCRM e grupo geral</h2><p className="mt-1 text-sm text-[var(--text-tertiary)]">Aos 200%, o aviso vai também ao líder e ao grupo.</p></div>
          </div>
          <form className="grid gap-4" onSubmit={saveNotification}>
            <label className="flex items-center gap-3 rounded-md bg-[var(--bg-elevated)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]"><input className="size-4 accent-[var(--w3-red)]" defaultChecked={initialData.notification?.enabled ?? false} name="enabled" type="checkbox" /> Ativar alertas automáticos</label>
            <Input defaultValue={initialData.notification?.mcrmBaseUrl ?? ""} label="URL base do MCRM" name="mcrmBaseUrl" placeholder="https://mcrm.seudominio.com" type="url" />
            <Input label={initialData.notification?.tokenConfigured ? "Novo bearer (deixe vazio para manter o atual)" : "Bearer do MCRM"} name="mcrmToken" placeholder={initialData.notification?.tokenConfigured ? "Token já configurado" : "Token manager com escopo mcp:write"} type="password" />
            <Input defaultValue={initialData.notification?.generalGroupConversationId ?? ""} label="ID da conversa do grupo geral" name="generalGroupConversationId" placeholder="UUID da conversa no MCRM" />
            <Button disabled={pending} type="submit">Salvar integração</Button>
          </form>
        </Card>
      </div>

      <Card className="hover:shadow-sm">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid size-9 place-items-center rounded-md bg-[var(--w3-red-bg)] text-[var(--w3-red)]"><UsersRound aria-hidden className="size-4" /></span>
          <div><h2 className="font-semibold text-[var(--text-primary)]">Pessoas, líderes e conversas</h2><p className="mt-1 text-sm text-[var(--text-tertiary)]">A conversa pessoal de cada usuário e seu líder determinam os destinatários.</p></div>
        </div>
        <div className="space-y-3">
          {initialData.members.map((member) => {
            const profile = initialData.profiles.find((item) => item.userId === member.id);
            return (
              <form className="grid gap-3 rounded-md border border-[var(--border-subtle)] p-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(17rem,1.4fr)_auto] lg:items-end" key={member.id} onSubmit={(event) => saveMember(event, member.id)}>
                <div className="min-w-0 self-center"><p className="truncate text-sm font-semibold text-[var(--text-primary)]">{member.name || member.email}</p><p className="truncate text-xs text-[var(--text-tertiary)]">{member.email}</p></div>
                <label className="grid gap-2"><span className="text-caption text-[var(--text-tertiary)]">Líder</span><select className={selectClassName} defaultValue={profile?.leaderUserId ?? ""} name="leaderUserId"><option value="">Sem líder</option>{initialData.members.filter((candidate) => candidate.id !== member.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.email}</option>)}</select></label>
                <Input defaultValue={profile?.mcrmConversationId ?? ""} label="Conversa pessoal no MCRM" name="mcrmConversationId" placeholder="UUID da conversa" />
                <Button disabled={pending} size="sm" type="submit" variant="secondary">Salvar</Button>
              </form>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
