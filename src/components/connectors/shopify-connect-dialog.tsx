"use client";

import { Cable, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { connectShopifyAction } from "@/app/(app)/connectors/shopify-connect-action";
import { Button } from "@/components/ui/button";

export function ShopifyConnectDialog() {
  const [open, setOpen] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button
        className="w-fit"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
      >
        <Cable size={16} aria-hidden="true" />
        Conectar Shopify
      </Button>

      {open ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          role="dialog"
        >
          <div className="w-full max-w-md rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Conectar Shopify
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  Insira as credenciais da API para conectar sua conta.
                </p>
              </div>
              <button
                aria-label="Fechar"
                className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <form action={connectShopifyAction} className="mt-5 grid gap-4">
              <Field
                autoFocus
                inputRef={firstFieldRef}
                label="Client ID"
                name="clientId"
                placeholder="Insira o Client ID do app Shopify"
                required
              />
              <Field
                label="Client Secret"
                name="clientSecret"
                placeholder="Insira o Client Secret"
                required
                type="password"
              />
              <Field
                helper="Ex: minha-loja.myshopify.com"
                label="Domínio da Loja"
                name="shop"
                placeholder="minha-loja.myshopify.com"
                required
              />

              <div className="mt-2 flex items-center justify-end gap-3">
                <Button
                  onClick={() => setOpen(false)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Cancelar
                </Button>
                <Button size="sm" type="submit">
                  <Cable size={14} aria-hidden="true" />
                  Autorizar
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

type FieldProps = {
  autoFocus?: boolean;
  helper?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
};

function Field({
  autoFocus,
  helper,
  inputRef,
  label,
  name,
  placeholder,
  required,
  type = "text",
}: FieldProps) {
  const reactId = useId();
  const inputId = `shopify-${name}-${reactId}`;
  const helperId = helper ? `${inputId}-helper` : undefined;
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label
        className="font-medium text-[var(--text-primary)]"
        htmlFor={inputId}
      >
        {label}
      </label>
      <input
        aria-describedby={helperId}
        autoFocus={autoFocus}
        className="h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 text-sm outline-none transition focus:border-[var(--w3-red)] focus:ring-2 focus:ring-[var(--w3-red)]/30"
        id={inputId}
        name={name}
        placeholder={placeholder}
        ref={inputRef}
        required={required}
        type={type}
      />
      {helper ? (
        <span className="text-xs text-[var(--text-tertiary)]" id={helperId}>
          {helper}
        </span>
      ) : null}
    </div>
  );
}
