import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg-canvas)] px-4 text-[var(--text-primary)]">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Página não encontrada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Não encontramos essa rota. Volte para o dashboard ou confira o endereço.
          </p>
          <Button asChild>
            <Link href="/dashboard">Voltar para o dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
