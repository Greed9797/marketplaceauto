"use client";

// TEMPORARY preview route — renders the redesigned SidebarClient with mock data
// so the new design can be inspected without DB/auth. Safe to delete.

import {
  SidebarClient,
  type SidebarNavItem,
} from "@/components/layouts/sidebar-client";

const navItems: SidebarNavItem[] = [
  {
    label: "Dashboard",
    href: "/preview/sidebar",
    icon: "dashboard",
    section: "overview",
  },
  { label: "Marcas", href: "/dashboards", icon: "brands", section: "overview" },
  {
    label: "Usuários",
    href: "/platform/users",
    icon: "users",
    section: "manage",
  },
  {
    label: "Conectores",
    href: "/connectors",
    icon: "connectors",
    section: "manage",
  },
  {
    label: "Membros",
    href: "/workspace/members",
    icon: "users",
    section: "manage",
  },
  { label: "Perfil", href: "/profile", icon: "profile", section: "account" },
  { label: "FAQ / Ajuda", href: "/faq", icon: "help", section: "account" },
  {
    label: "Conta e workspaces",
    href: "/workspace/settings",
    icon: "settings",
    section: "account",
  },
  {
    label: "Config. conectores",
    href: "/connectors/settings",
    icon: "settings",
    section: "account",
  },
];

export default function SidebarPreviewPage() {
  return (
    <main className="w3-app-shell min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <div className="min-h-screen lg:flex">
        <SidebarClient
          currentRoleLabel="Proprietário"
          currentWorkspace={{ id: "w1", name: "Adstart W3" }}
          logoutAction={async () => {}}
          navItems={navItems}
          userEmail="leo@leonardoames.com.br"
          userImage={null}
          userName="Leonardo Ames"
        />
        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex min-h-[72px] items-center justify-between gap-4 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-canvas)_88%,transparent)] px-8 py-4 backdrop-blur">
            <div>
              <p className="text-caption text-[var(--text-tertiary)]">
                Adstart W3 / Proprietário
              </p>
              <h1 className="mt-1 font-sans text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
                W3 Relatórios
              </h1>
            </div>
            <span className="rounded-[var(--radius-pill)] bg-[var(--w3-red-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--w3-red)]">
              Preview da sidebar
            </span>
          </header>
          <div className="grid grid-cols-1 gap-4 p-8 sm:grid-cols-2 xl:grid-cols-3">
            {[
              "Receita",
              "Pedidos",
              "Ticket médio",
              "ROAS",
              "Sessões",
              "Conversão",
            ].map((label) => (
              <div
                className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]"
                key={label}
              >
                <p className="text-caption text-[var(--text-tertiary)]">
                  {label}
                </p>
                <p className="text-kpi mt-3 text-[var(--text-primary)]">—</p>
                <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                  placeholder de conteúdo
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
