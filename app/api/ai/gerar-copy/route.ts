import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { clientes } from '@/lib/db/schema'
import { gerarCopy } from '@/lib/ai/gemini'

export const runtime = 'nodejs'

const gerarCopySchema = z.object({
  cliente_id: z.string().min(1),
  nome_produto: z.string().trim().min(1),
})

export async function POST(req: Request) {
  const body = await req.json()
  const parsed = gerarCopySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Cliente e nome do produto sao obrigatorios.' }, { status: 400 })
  }

  const [cliente] = await db
    .select({
      nicho: clientes.nicho,
      estiloDescricao: clientes.estiloDescricao,
      exemplosTitulos: clientes.exemplosTitulos,
      exemplosDescricoes: clientes.exemplosDescricoes,
    })
    .from(clientes)
    .where(eq(clientes.id, parsed.data.cliente_id))
    .limit(1)

  if (!cliente) {
    return NextResponse.json({ error: 'Cliente nao encontrado.' }, { status: 404 })
  }

  try {
    const copy = await gerarCopy({
      nomeProduto: parsed.data.nome_produto,
      nicho: cliente.nicho ?? '',
      estiloDescricao: cliente.estiloDescricao ?? '',
      exemplosTitulos: cliente.exemplosTitulos ? JSON.parse(cliente.exemplosTitulos) : [],
      exemplosDescricoes: cliente.exemplosDescricoes ? JSON.parse(cliente.exemplosDescricoes) : [],
    })

    return NextResponse.json(copy)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao gerar copy com Gemini.' },
      { status: 500 },
    )
  }
}
