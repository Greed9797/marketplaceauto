"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

export type FaqNavItem = { title: string; href: string };
export type FaqNavGroup = { label: string; items: FaqNavItem[] };

export function FaqSidebarNav({ groups }: { groups: FaqNavGroup[] }) {
  const pathname = usePathname() ?? "";

  return (
    <nav className="sticky top-[88px] space-y-7">
      <Link
        className="inline-flex items-center gap-1.5 text-caption text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        href="/faq"
      >
        <span aria-hidden>←</span> Início do FAQ
      </Link>

      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-2 px-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-[var(--w3-red-bg)] font-semibold text-[var(--w3-red)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]",
                    )}
                    href={item.href}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
