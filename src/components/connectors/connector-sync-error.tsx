import { AlertTriangle } from "lucide-react";
import type { ConnectorProvider } from "@prisma/client";

import { humanizeConnectorSyncError } from "@/lib/connectors/humanize-sync-error";

/**
 * Renders a raw connector `lastSyncError` as a friendly, actionable message.
 * The original error stays available under a collapsed "Detalhe técnico" so
 * support can still see it. Native <details> — no client JS required.
 */
export function ConnectorSyncError({
  error,
  provider,
}: {
  error: string;
  provider: ConnectorProvider;
}) {
  const friendly = humanizeConnectorSyncError(error, provider);

  return (
    <div className="mt-1.5 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-2.5 py-2">
      <p className="flex items-center gap-1.5 font-medium text-[var(--danger)]">
        <AlertTriangle aria-hidden className="size-4 shrink-0" />
        {friendly.title}
      </p>
      <p className="mt-0.5 text-[var(--text-secondary)]">{friendly.action}</p>
      <details className="mt-1">
        <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
          Detalhe técnico
        </summary>
        <p className="mt-1 break-all font-mono text-[10px] text-[var(--text-tertiary)]">
          {friendly.detail}
        </p>
      </details>
    </div>
  );
}
