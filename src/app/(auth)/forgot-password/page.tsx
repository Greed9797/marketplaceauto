import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { forgotPasswordAction } from "../actions";

type ForgotPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;
  const sent = params.sent;

  return (
    <Card className="w-full">
      <CardHeader>
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">Recuperacao</p>
          <h1 className="mt-2 text-[1.75rem] font-semibold tracking-[-0.02em]">
            Redefinir senha
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Enviaremos um link valido por 30 minutos, se o email existir na plataforma.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {sent ? (
          <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
            Se encontramos esse email, o link de redefinicao ja foi enviado.
          </p>
        ) : null}
        <form action={forgotPasswordAction} className="space-y-4">
          <Input label="Email" name="email" type="email" autoComplete="email" required />
          <Button className="w-full" type="submit">
            Enviar link de redefinicao
          </Button>
        </form>
        <Link className="text-sm font-medium text-[var(--w3-red)]" href="/login">
          Voltar para login
        </Link>
      </CardContent>
    </Card>
  );
}
