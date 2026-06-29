import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { resetPasswordAction } from "../actions";

type ResetPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const error = params.error;

  return (
    <Card className="w-full">
      <CardHeader>
        <div>
          <p className="text-caption text-[var(--text-tertiary)]">Nova senha</p>
          <h1 className="mt-2 text-[1.75rem] font-semibold tracking-[-0.02em]">
            Atualizar senha
          </h1>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <p className="rounded-md bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">
            Link invalido ou expirado. Solicite um novo link.
          </p>
        ) : null}
        <form action={resetPasswordAction} className="space-y-4">
          <input name="token" type="hidden" value={token} />
          <Input label="Nova senha" name="password" type="password" autoComplete="new-password" required />
          <Button className="w-full" type="submit">
            Atualizar senha
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
