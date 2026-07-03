import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { importClienteListings } from "@/lib/publisher/import-listings";
import {
  requireClienteInWorkspace,
  requirePublisherWorkspace,
} from "@/lib/publisher/route-guard";

export const runtime = "nodejs";
export const maxDuration = 300;

const importSchema = z.object({
  clienteId: z.string().min(1),
  plataforma: z.enum(["MERCADO_LIVRE", "SHOPEE"]),
});

export async function POST(request: NextRequest) {
  const guard = await requirePublisherWorkspace();
  if (!guard.ok) return guard.response;

  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Dados inválidos" },
      { status: 400 },
    );
  }

  const cliente = await requireClienteInWorkspace({
    clienteId: parsed.data.clienteId,
    workspaceId: guard.workspaceId,
  });
  if (!cliente.ok) return cliente.response;

  try {
    const result = await importClienteListings({
      clienteId: cliente.clienteId,
      platform: parsed.data.plataforma,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Falha ao importar anúncios.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    );
  }
}
