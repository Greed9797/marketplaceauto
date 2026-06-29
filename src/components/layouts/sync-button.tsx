"use client";

import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { manualSyncAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";

type SyncState = "idle" | "syncing" | "done" | "locked" | "error";

const LABELS: Record<SyncState, string> = {
  idle: "Sincronizar agora",
  syncing: "Sincronizando...",
  done: "Sincronizado",
  locked: "Sync em andamento",
  error: "Erro ao sincronizar",
};

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<SyncState>("idle");

  async function handleSync() {
    if (state === "syncing") return;
    setState("syncing");
    try {
      const result = await manualSyncAction();
      setState(result.ok ? "done" : "locked");
      // Sync ran synchronously across every ACTIVE connector — pull fresh
      // server data into the dashboard so the new metrics show immediately.
      if (result.ok) {
        router.refresh();
      }
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 3000);
  }

  return (
    <Button
      variant="secondary"
      className="gap-2"
      onClick={handleSync}
      disabled={state === "syncing"}
    >
      {state === "done" ? (
        <CheckCircle2 aria-hidden className="size-4 text-[var(--success)]" />
      ) : state === "error" ? (
        <AlertCircle aria-hidden className="size-4 text-[var(--danger)]" />
      ) : (
        <RefreshCw
          aria-hidden
          className={`size-4 ${state === "syncing" ? "animate-spin" : ""}`}
        />
      )}
      {LABELS[state]}
    </Button>
  );
}
