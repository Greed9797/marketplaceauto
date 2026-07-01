import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isNextControlFlowError } from "@/lib/connectors/oauth-route-error";
import { prisma } from "@/lib/db/prisma";
import {
  requireClienteInWorkspace,
  requirePublisherWorkspace,
} from "@/lib/publisher/route-guard";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const emptyToNull = (value: string) =>
  value.trim() === "" ? null : value.trim();

const updateClienteSchema = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório.").max(200),
  nicho: z.string().max(200).transform(emptyToNull).nullable().optional(),
  estiloDescricao: z
    .string()
    .max(2000)
    .transform(emptyToNull)
    .nullable()
    .optional(),
  exemplosTitulos: z
    .string()
    .max(4000)
    .transform(emptyToNull)
    .nullable()
    .optional(),
  exemplosDescricoes: z
    .string()
    .max(8000)
    .transform(emptyToNull)
    .nullable()
    .optional(),
  dadosFiscais: z
    .string()
    .max(4000)
    .transform(emptyToNull)
    .nullable()
    .optional(),
  comissaoPercent: z
    .union([z.string(), z.number(), z.null()])
    .transform((value) =>
      typeof value === "string" ? value.trim().replace(",", ".") : value,
    )
    .transform((value) =>
      value === "" || value === null ? null : Number(value),
    )
    .refine(
      (value) =>
        value === null ||
        (Number.isFinite(value) && value >= 0 && value <= 100),
      "Comissão deve estar entre 0 e 100.",
    )
    .optional(),
});

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requirePublisherWorkspace();
    if (!guard.ok) return guard.response;

    const { id } = await context.params;
    const cliente = await requireClienteInWorkspace({
      clienteId: id,
      workspaceId: guard.workspaceId,
    });
    if (!cliente.ok) return cliente.response;

    const json = (await request.json().catch(() => null)) as unknown;
    const parsed = updateClienteSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
        },
        { status: 400 },
      );
    }

    const updated = await prisma.cliente.update({
      where: { id: cliente.clienteId },
      data: {
        nome: parsed.data.nome,
        nicho: parsed.data.nicho ?? null,
        estiloDescricao: parsed.data.estiloDescricao ?? null,
        exemplosTitulos: parsed.data.exemplosTitulos ?? null,
        exemplosDescricoes: parsed.data.exemplosDescricoes ?? null,
        dadosFiscais: parsed.data.dadosFiscais ?? null,
        comissaoPercent: parsed.data.comissaoPercent ?? null,
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    if (isNextControlFlowError(error)) throw error;
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[api/clientes/:id] update failed: ${message}`);
    return NextResponse.json(
      { success: false, error: "Falha ao atualizar cliente" },
      { status: 500 },
    );
  }
}
