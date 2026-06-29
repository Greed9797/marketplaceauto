"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type AppErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: "app-shell" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <AlertTriangle
            aria-hidden
            className="mx-auto size-10 text-[var(--danger)]"
          />
          <h2 className="text-lg font-semibold">Algo deu errado.</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Tivemos um erro inesperado ao carregar essa página. A equipe já foi
            notificada. Você pode tentar novamente ou voltar ao dashboard.
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
              <a href="/dashboard">Ir para o dashboard</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
