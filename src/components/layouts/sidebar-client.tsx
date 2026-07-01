"use client";

import {
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Package,
  PanelsTopLeft,
  PlugZap,
  Send,
  Settings,
  Store,
  Timer,
  UserCircle,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { W3Logo } from "@/components/brand/w3-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

import { useMobileNav } from "./mobile-nav-context";

export type SidebarIconKey =
  | "dashboard"
  | "brands"
  | "clientes"
  | "produtos"
  | "publicacoes"
  | "users"
  | "connectors"
  | "profile"
  | "help"
  | "settings"
  | "timer";

export type SidebarSection = "overview" | "manage" | "account";

export type SidebarNavItem = {
  label: string;
  href: string;
  icon: SidebarIconKey;
  section: SidebarSection;
};

type SidebarClientProps = {
  navItems: SidebarNavItem[];
  currentWorkspace: {
    id: string;
    name: string;
  };
  currentRoleLabel: string;
  userName: string | null;
  userEmail: string;
  userImage: string | null;
  logoutAction: () => void | Promise<void>;
};

const iconMap: Record<SidebarIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  brands: PanelsTopLeft,
  clientes: Store,
  produtos: Package,
  publicacoes: Send,
  users: UsersRound,
  connectors: PlugZap,
  profile: UserCircle,
  help: HelpCircle,
  settings: Settings,
  timer: Timer,
};

const SECTIONS: { key: SidebarSection; label: string }[] = [
  { key: "overview", label: "Visão geral" },
  { key: "manage", label: "Gerenciar" },
  { key: "account", label: "Conta" },
];

function getInitials(name: string | null, email: string) {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

/**
 * Resolve the single nav item that matches the current pathname, preferring the
 * longest href so nested routes (e.g. /connectors/settings) win over their
 * parent (/connectors).
 */
function resolveActiveHref(navItems: SidebarNavItem[], pathname: string) {
  return navItems
    .filter(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

function Avatar({
  name,
  email,
  image,
  className,
}: {
  name: string | null;
  email: string;
  image: string | null;
  className?: string;
}) {
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={name ?? email}
        className={cn(
          "shrink-0 rounded-full object-cover",
          className ?? "size-9",
        )}
        src={image}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-secondary)]",
        className ?? "size-9",
      )}
    >
      {getInitials(name, email)}
    </span>
  );
}

/**
 * Navigation lives in a single off-canvas drawer at ALL widths (opened by the
 * hamburger in the Topbar). There is no persistent sidebar, so page content
 * uses the full screen width. The drawer overlays content and closes on
 * navigation, Escape, or backdrop click.
 */
export function SidebarClient({
  currentRoleLabel,
  currentWorkspace,
  logoutAction,
  navItems,
  userEmail,
  userImage,
  userName,
}: SidebarClientProps) {
  const { open, setOpen } = useMobileNav();
  const pathname = usePathname() ?? "";
  const activeHref = resolveActiveHref(navItems, pathname);
  const workspaceInitial =
    currentWorkspace.name.trim().charAt(0).toUpperCase() || "W";
  const displayName = userName?.trim() || userEmail.split("@")[0];

  // Close on Escape and lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, setOpen]);

  return (
    <>
      <div
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setOpen(false)}
      />
      <aside
        aria-label="Navegação"
        data-nav-drawer
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(82vw,18rem)] flex-col overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-[72px] items-center justify-between px-5">
          <W3Logo />
          <Button
            aria-label="Fechar menu"
            className="size-9 text-[var(--text-tertiary)]"
            onClick={() => setOpen(false)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden className="size-5" />
          </Button>
        </div>
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-elevated)] px-2.5 py-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-primary)]">
              {workspaceInitial}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                {currentWorkspace.name}
              </span>
              <span className="block truncate text-xs text-[var(--text-tertiary)]">
                {currentRoleLabel}
              </span>
            </span>
          </div>
        </div>
        <nav className="flex-1 px-3 pb-4">
          <div className="space-y-6">
            {SECTIONS.map((section) => {
              const items = navItems.filter(
                (item) => item.section === section.key,
              );
              if (items.length === 0) return null;
              return (
                <div className="space-y-1" key={section.key}>
                  <p className="px-3 pb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                    {section.label}
                  </p>
                  {items.map((item) => {
                    const Icon = iconMap[item.icon];
                    const isActive = item.href === activeHref;
                    return (
                      <Link
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-[var(--w3-red-bg)] text-[var(--w3-red)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]",
                        )}
                        href={item.href}
                        key={item.href}
                        onClick={() => setOpen(false)}
                      >
                        <Icon
                          aria-hidden
                          className="size-[18px] shrink-0"
                          strokeWidth={isActive ? 2.2 : 1.8}
                        />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </nav>
        <div className="border-t border-[var(--border-subtle)] p-3">
          <div className="flex items-center gap-3 rounded-lg px-1.5 py-1.5">
            <Avatar
              className="size-9"
              email={userEmail}
              image={userImage}
              name={userName}
            />
            <div className="min-w-0 flex-1" title={userEmail}>
              <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                {displayName}
              </p>
              <p className="truncate text-xs text-[var(--text-tertiary)]">
                {currentRoleLabel}
              </p>
            </div>
            <form action={logoutAction}>
              <Button
                aria-label="Sair"
                className="size-9 shrink-0 text-[var(--text-tertiary)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                size="icon"
                title="Sair"
                type="submit"
                variant="ghost"
              >
                <LogOut aria-hidden className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
