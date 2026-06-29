import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[var(--bg-canvas)] px-4 py-10 text-[var(--text-primary)]">
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle>Termos de uso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-7 text-[var(--text-secondary)]">
          <p>
            Estes termos regem o uso do Adstart W3 durante o beta privado. O
            produto consolida métricas de marketplaces e e-commerce para análise
            operacional do workspace autorizado.
          </p>
          <p>
            Ao conectar Mercado Livre, Shopee ou Shopify, você declara ter
            permissão para autorizar o acesso aos dados dessas contas e
            compartilhar as informações com membros do workspace.
          </p>
          <p>
            O beta pode exibir dados parciais durante backfills e
            sincronizações. A metodologia de cálculo do dashboard é baseada nas
            tabelas `EcommerceOrder` e `DailyMetric`.
          </p>
          <p>
            Dúvidas sobre privacidade e LGPD:{" "}
            <a
              className="font-semibold text-[var(--w3-red)]"
              href="mailto:dpo@w3educacao.com.br"
            >
              dpo@w3educacao.com.br
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
