"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

const storageKey = "adstart_w3_cookie_consent";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(window.localStorage.getItem(storageKey) !== "accepted");
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className="pointer-events-auto fixed bottom-4 left-4 right-4 z-[1000] rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] p-4 shadow-lg md:left-auto md:max-w-md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-[var(--text-secondary)]">
          Usamos cookies essenciais para manter sua sessão e preferências do beta.
        </p>
        <Button
          size="sm"
          type="button"
          onClick={() => {
            window.localStorage.setItem(storageKey, "accepted");
            setVisible(false);
          }}
        >
          Entendi
        </Button>
      </div>
    </div>
  );
}
