"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

type MobileNavState = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const MobileNavContext = createContext<MobileNavState | null>(null);

/**
 * Shares the mobile drawer open/close state between the Topbar trigger and the
 * Sidebar drawer (which live in separate render trees). Auto-closes on route
 * change so navigating doesn't leave the overlay stuck open.
 */
export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <MobileNavContext.Provider value={{ open, setOpen }}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav(): MobileNavState {
  const ctx = useContext(MobileNavContext);
  if (!ctx) {
    // Safe fallback so a consumer rendered outside the provider never crashes.
    return { open: false, setOpen: () => {} };
  }
  return ctx;
}
