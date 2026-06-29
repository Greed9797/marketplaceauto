import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/auth/current";
import { isAdminMaster } from "@/lib/auth/platform-permissions";
import { prisma } from "@/lib/db/prisma";

import { bootstrapW3AdminAction } from "./actions";

export default async function PlatformBootstrapPage() {
  const context = await getCurrentUserContext();

  if (isAdminMaster(context.user)) {
    redirect("/connectors/settings");
  }

  const existingAdmins = await prisma.user.count({
    where: { platformRole: { in: ["ADMIN_MASTER", "W3_ADMIN"] } },
  });

  if (existingAdmins > 0) {
    redirect("/connectors");
  }

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card>
        <CardHeader>
          <CardTitle>Ativar primeiro administrador W3</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            Ainda não existe um administrador interno para configurar apps e
            APIs dos conectores. Esta ação promove o usuário atual a Admin
            Master.
          </p>
          <form action={bootstrapW3AdminAction}>
            <Button type="submit">Ativar meu acesso Admin Master</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
