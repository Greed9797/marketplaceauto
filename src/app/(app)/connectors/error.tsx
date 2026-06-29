"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ConnectorsErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ConnectorsError({
  error,
  reset,
}: ConnectorsErrorProps) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: "connectors" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <Card>
      <CardContent className="space-y-4 p-6 text-center">
        <AlertTriangle
          aria-hidden
          className="mx-auto size-10 text-[var(--danger)]"
        />
        <h2 className="text-lg font-semibold">
          Não foi possível carregar conectores.
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Pode ser uma falha temporária com a API do provedor ou com nosso
          banco. Tente novamente em instantes.
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
