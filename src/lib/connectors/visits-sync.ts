import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import { createHash } from "node:crypto";

import { connectorCredentialsFromAccountVaultAware } from "@/lib/connectors/credentials";
import { MercadoLivreClient } from "@/lib/connectors/mercado-livre/client";
import { prisma } from "@/lib/db/prisma";

/**
 * DedupeHash da linha de VISITAS — distinto do rollup de receita (que usa
 * ecommerceDailyDedupeHash sem sufixo), então as duas linhas do mesmo
 * source+date+connector coexistem sem colidir na constraint única.
 */
function visitsDedupeHash(input: {
  workspaceId: string;
  connectorAccountId: string;
  provider: ConnectorProvider;
  date: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.workspaceId,
        input.connectorAccountId,
        input.provider,
        input.date,
        "visits",
      ].join(":"),
    )
    .digest("hex");
}

function dayCountInclusive(since: string, until: string): number {
  const from = Date.parse(`${since.slice(0, 10)}T00:00:00.000Z`);
  const to = Date.parse(`${until.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 1;
  return Math.floor((to - from) / 86_400_000) + 1;
}

/**
 * Sincroniza VISITAS diárias do Mercado Livre para `DailyMetric.sessions`
 * (source=MERCADO_LIVRE), alimentando o card "Visitas" do dashboard. Usa o
 * token do próprio seller já armazenado (o order-sync o renova antes). No-op
 * para conector não-ML/inativo/sem token. Idempotente: upsert por dedupeHash.
 * Best-effort — o chamador embrulha em try/catch (visitas são suplementares à
 * receita e nunca podem derrubar o sync de pedidos).
 */
export async function syncMercadoLivreVisits(input: {
  connectorAccountId: string;
  since: string;
  until: string;
}): Promise<{ count: number }> {
  const connector = await prisma.connectorAccount.findUnique({
    where: { id: input.connectorAccountId },
    select: {
      id: true,
      workspaceId: true,
      provider: true,
      status: true,
      externalAccountId: true,
      credentialSecretId: true,
      accessTokenCiphertext: true,
      tokenIv: true,
      tokenAuthTag: true,
      tokenKeyVersion: true,
    },
  });

  if (
    !connector ||
    connector.provider !== ConnectorProvider.MERCADO_LIVRE ||
    connector.status !== ConnectorStatus.ACTIVE ||
    !connector.externalAccountId
  ) {
    return { count: 0 };
  }

  const credentials =
    await connectorCredentialsFromAccountVaultAware(connector);
  const accessToken =
    typeof credentials.accessToken === "string"
      ? credentials.accessToken
      : null;
  if (!accessToken) return { count: 0 };

  // Listar orders não é necessário; visitas só pedem token + seller id. O
  // client sem config só usa o access token (não faz refresh aqui).
  const client = new MercadoLivreClient({});
  const rows = await client.fetchDailyVisits({
    sellerId: connector.externalAccountId,
    accessToken,
    endingDate: input.until,
    lastDays: dayCountInclusive(input.since, input.until),
  });

  for (const row of rows) {
    const dedupeHash = visitsDedupeHash({
      workspaceId: connector.workspaceId,
      connectorAccountId: connector.id,
      provider: ConnectorProvider.MERCADO_LIVRE,
      date: row.date,
    });
    await prisma.dailyMetric.upsert({
      where: { dedupeHash },
      update: { sessions: BigInt(Math.max(0, Math.trunc(row.total))) },
      create: {
        workspaceId: connector.workspaceId,
        connectorAccountId: connector.id,
        date: new Date(`${row.date}T00:00:00.000Z`),
        source: ConnectorProvider.MERCADO_LIVRE,
        sessions: BigInt(Math.max(0, Math.trunc(row.total))),
        dedupeHash,
      },
    });
  }

  return { count: rows.length };
}
