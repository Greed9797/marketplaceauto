import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { googleSignInAction, loginAction } from "../actions";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const error = params.error;
  const reset = params.reset;
  const errorMessage =
    error === "google-not-configured"
      ? "Google OAuth ainda nao esta configurado neste ambiente."
      : error === "signup-closed"
        ? "Cadastro público fechado. Peça acesso para um Admin Master W3."
      : "Não conseguimos entrar com esses dados. Confira as informacoes e tente novamente.";

  return (
    <Card className="w-full">
      <CardHeader>
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">Adstart W3</p>
          <h1 className="mt-2 text-[1.75rem] font-semibold tracking-[-0.02em]">
            Entrar na sua conta
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Use email e senha ou continue com sua conta Google.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <p className="rounded-md bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
            {errorMessage}
          </p>
        ) : null}
        {reset ? (
          <p className="rounded-md bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">
            Senha atualizada. Entre novamente para continuar.
          </p>
        ) : null}
        <form action={loginAction} className="space-y-4">
          <Input label="Email" name="email" type="email" autoComplete="email" required />
          <Input label="Senha" name="password" type="password" autoComplete="current-password" required />
          <Button className="w-full" type="submit">
            Entrar na sua conta
          </Button>
        </form>
        <form action={googleSignInAction}>
          <Button className="w-full" type="submit" variant="secondary">
            Entrar com Google
          </Button>
        </form>
        <div className="flex flex-wrap justify-between gap-3 text-sm text-[var(--text-secondary)]">
          <Link className="font-medium text-[var(--w3-red)]" href="/forgot-password">
            Esqueci minha senha
          </Link>
          <Link className="font-medium text-[var(--w3-red)]" href="/sign-up">
            Criar conta grátis
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
