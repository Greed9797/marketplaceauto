"use client";

import { KeyRound, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { connectMetaSystemUserAction } from "@/app/(app)/connectors/meta-system-user-action";
import { Button } from "@/components/ui/button";

export function MetaSystemUserDialog() {
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
        <KeyRound size={14} aria-hidden="true" />
        Conectar Meta Ads
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
                  Conectar Meta Ads via System User
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  Cole o token longo do Business Manager e o ID da conta de
                  anúncios.
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

            <form
              action={connectMetaSystemUserAction}
              className="mt-5 grid gap-4"
            >
              <Field
                helper="System User token gerado no Business Manager (ads_read)."
                inputRef={firstFieldRef}
                label="Access Token"
                name="accessToken"
                placeholder="EAAB..."
                required
                type="password"
              />
              <Field
                helper="Apenas os dígitos. Não inclua o prefixo act_."
                label="Ad Account ID"
                name="adAccountId"
                placeholder="1234567890"
                required
              />
              <Field
                helper="Nome amigável exibido na lista de contas (opcional)."
                label="Nome da conta"
                name="accountName"
                placeholder="Cliente XPTO — Meta"
              />

              <p className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-secondary)]">
                Para mapear leads/agendamentos do pixel, cadastre os IDs em{" "}
                <Link
                  className="underline"
                  href="/connectors/settings/meta_ads"
                >
                  Configurações &gt; Meta Ads
                </Link>
                .
              </p>

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
                  <KeyRound size={14} aria-hidden="true" />
                  Conectar
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
  helper?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
};

function Field({
  helper,
  inputRef,
  label,
  name,
  placeholder,
  required,
  type = "text",
}: FieldProps) {
  const reactId = useId();
  const inputId = `meta-${name}-${reactId}`;
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
