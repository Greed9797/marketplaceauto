"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils/cn";

type Theme = "dark" | "light";

const storageKey = "adstart-w3-theme";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "dark";
  }

  const value = window.localStorage.getItem(storageKey);
  return value === "light" || value === "dark" ? value : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(storageKey, theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const storedTheme = readStoredTheme();
    setTheme(storedTheme);
    applyTheme(storedTheme);
  }, []);

  function selectTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  const options = [
    {
      value: "dark" as const,
      label: "Escuro",
      ariaLabel: "Usar tema escuro",
      icon: Moon,
    },
    {
      value: "light" as const,
      label: "Claro",
      ariaLabel: "Usar tema claro",
      icon: Sun,
    },
  ];

  return (
    <div
      aria-label="Tema"
      className="relative grid h-10 grid-cols-2 rounded-[var(--radius-pill)] border border-[var(--border-strong)] bg-[var(--theme-toggle-bg)] p-1 shadow-sm"
      role="group"
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-1 top-1 h-8 w-[calc(50%-4px)] rounded-[var(--radius-pill)] bg-[var(--w3-red)] transition-transform duration-200 ease-out",
          theme === "light" ? "translate-x-full" : "translate-x-0",
        )}
      />
      {options.map((option) => {
        const Icon = option.icon;
        const selected = theme === option.value;

        return (
          <button
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            className={cn(
              "relative z-10 inline-flex h-8 min-w-[76px] items-center justify-center gap-1.5 rounded-[var(--radius-pill)] px-3 text-xs font-semibold transition-colors",
              selected ? "text-white" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
            key={option.value}
            onClick={() => selectTheme(option.value)}
            type="button"
          >
            <Icon aria-hidden className="size-3.5" strokeWidth={2} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
