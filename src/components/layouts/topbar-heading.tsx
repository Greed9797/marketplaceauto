"use client";

import { usePathname } from "next/navigation";

/**
 * Shows the active workspace breadcrumb only when the user is actually inside a
 * workspace. On Marcas (the lobby, `/dashboards`) no brand is "open", so nothing
 * is shown — the topbar is just the logo. The system name is the logo itself,
 * so there is no separate title.
 */
export function TopbarHeading({ workspaceLabel }: { workspaceLabel: string }) {
  const pathname = usePathname() ?? "";
  if (pathname === "/dashboards") return null;

  return (
    <p className="min-w-0 truncate text-sm font-medium text-[var(--text-secondary)]">
      {workspaceLabel}
    </p>
  );
}
