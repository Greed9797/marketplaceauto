"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildSanitizedClientError } from "@/lib/observability/analytics";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    void fetch("/api/observability/client-error", {
      method: "POST",
      keepalive: true,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildSanitizedClientError({
          message: error.message,
          stack: error.stack,
          digest: error.digest,
          path: window.location.pathname,
        }),
      ),
    }).catch(() => undefined);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg-canvas)] px-4 text-[var(--text-primary)]">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Não conseguimos carregar agora</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Tentaremos novamente ao recarregar. Se persistir, o erro será tratado no monitoramento.
          </p>
          <Button type="button" onClick={() => reset()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
