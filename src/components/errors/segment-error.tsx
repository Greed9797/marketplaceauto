"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type SegmentErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  /** Sentry boundary tag, e.g. "workspace-settings". */
  boundary: string;
  title?: string;
};

/**
 * Shared per-segment error boundary UI. Each route segment's `error.tsx`
 * re-exports a thin client component that renders this with its own boundary
 * tag, so a failure in one segment stays contained instead of bubbling to the
 * app-shell boundary.
 */
export function SegmentError({
  error,
  reset,
  boundary,
  title,
}: SegmentErrorProps) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary },
      extra: { digest: error.digest },
    });
  }, [error, boundary]);

  return (
    <Card>
      <CardContent className="space-y-4 p-6 text-center">
        <AlertTriangle
          aria-hidden
          className="mx-auto size-10 text-[var(--danger)]"
        />
        <h2 className="text-lg font-semibold">
          {title ?? "Algo deu errado nesta página."}
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Pode ser uma falha temporária. Tente novamente em instantes.
        </p>
        {error.digest ? (
          <p className="text-xs text-[var(--text-tertiary)]">
            Código de referência: <code>{error.digest}</code>
          </p>
        ) : null}
        <div className="flex justify-center gap-3">
          <Button onClick={reset} variant="primary">
            <RefreshCw aria-hidden className="size-4" />
            Tentar novamente
          </Button>
          <Button asChild variant="secondary">
            <a href="/dashboard">Voltar ao dashboard</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
