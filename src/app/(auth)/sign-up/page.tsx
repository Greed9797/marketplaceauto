import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { signUpAction } from "../actions";

type SignUpPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const errorMessages: Record<string, string> = {
  invalid: "Revise os campos antes de criar a conta.",
  "email-in-use": "Esse email ja possui uma conta. Entre ou use outro email.",
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? errorMessages[params.error] : null;
  const inviteToken = typeof params.invite === "string" ? params.invite : "";

  return (
    <Card className="w-full">
      <CardHeader>
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">Beta fechado</p>
          <h1 className="mt-2 text-[1.75rem] font-semibold tracking-[-0.02em]">
            Criar conta grátis
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Sua conta cria automaticamente o primeiro workspace da empresa.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <p className="rounded-md bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
        <form action={signUpAction} className="space-y-4">
          <input name="inviteToken" type="hidden" value={inviteToken} />
          <Input label="Nome" name="name" autoComplete="name" required />
          <Input label="Email" name="email" type="email" autoComplete="email" required />
          <Input label="Empresa" name="workspaceName" autoComplete="organization" required />
          <Input label="Senha" name="password" type="password" autoComplete="new-password" required />
          <label className="flex gap-3 text-sm leading-6 text-[var(--text-secondary)]">
            <input
              className="mt-1 size-4 accent-[var(--w3-red)]"
              name="acceptedTerms"
              type="checkbox"
              required
            />
            <span>
              Aceito os{" "}
              <Link className="font-medium text-[var(--w3-red)]" href="/terms">
                termos
              </Link>{" "}
              e a{" "}
              <Link className="font-medium text-[var(--w3-red)]" href="/privacy">
                politica de privacidade
              </Link>
              .
            </span>
          </label>
          <Button className="w-full" type="submit">
            Criar conta grátis
          </Button>
        </form>
        <p className="text-sm text-[var(--text-secondary)]">
          Ja tem conta?{" "}
          <Link className="font-medium text-[var(--w3-red)]" href="/login">
            Entrar na sua conta
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
