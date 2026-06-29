import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--bg-canvas)] px-4 py-10 text-[var(--text-primary)]">
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle>Política de privacidade</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-7 text-[var(--text-secondary)]">
          <p>
            O Adstart W3 trata dados de conta, workspace, conectores e métricas para operar o
            dashboard de marketing analytics contratado no beta privado.
          </p>
          <p>
            Tokens de conectores são armazenados criptografados em AES-256-GCM. Logs de auditoria
            registram ações sensíveis e devem evitar PII em texto livre.
          </p>
          <p>
            Você pode acessar exportação e solicitação de exclusão em Perfil &gt; Conta e
            privacidade. Solicitações reais ficam auditadas quando o banco estiver configurado.
          </p>
          <p>
            Contato de privacidade:{" "}
            <a className="font-semibold text-[var(--w3-red)]" href="mailto:dpo@w3educacao.com.br">
              dpo@w3educacao.com.br
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
