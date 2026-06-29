"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

interface RemoveConnectorButtonProps {
  connectorAccountId: string;
  accountLabel: string;
}

interface RemoveResponseBody {
  ok?: boolean;
  message?: string;
}

function parseBody(text: string): RemoveResponseBody | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return parsed as RemoveResponseBody;
    }
    return null;
  } catch {
    return null;
  }
}

export function RemoveConnectorButton({
  connectorAccountId,
  accountLabel,
}: RemoveConnectorButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (pending) return;
    const confirmed = window.confirm(
      `Remover o conector "${accountLabel}"? Os dados sincronizados dele neste workspace serão apagados. Esta ação não pode ser desfeita.`,
    );
    if (!confirmed) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/connectors/${connectorAccountId}`, {
        method: "DELETE",
      });
      const data = parseBody(await response.text());

      if (!response.ok || !data?.ok) {
        setError(
          data?.message ??
            `Falha ao remover (HTTP ${response.status}). Tente novamente.`,
        );
        return;
      }

      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        disabled={pending}
        onClick={remove}
        size="sm"
        type="button"
        variant="destructive"
      >
        <Trash2 size={16} aria-hidden="true" />
        {pending ? "Removendo…" : "Remover"}
      </Button>
      {error ? (
        <span className="text-xs text-[var(--danger)]">{error}</span>
      ) : null}
    </div>
  );
}
