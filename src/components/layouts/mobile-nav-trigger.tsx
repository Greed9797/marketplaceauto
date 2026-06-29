"use client";

import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useMobileNav } from "./mobile-nav-context";

/** Hamburger button (all widths) that opens the navigation drawer. */
export function MobileNavTrigger() {
  const { setOpen } = useMobileNav();

  return (
    <Button
      aria-label="Abrir menu de navegação"
      className="size-10 shrink-0 text-[var(--text-secondary)]"
      onClick={() => setOpen(true)}
      size="icon"
      type="button"
      variant="ghost"
    >
      <Menu aria-hidden className="size-5" />
    </Button>
  );
}
