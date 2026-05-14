import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { clientes } from '@/lib/db/schema'

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
    })
    .from(clientes)
    .where(eq(clientes.id, parsed.data.cliente_id))
    .limit(1)

  if (!cliente) {
    return NextResponse.json({ error: 'Cliente nao encontrado.' }, { status: 404 })
  }

  return NextResponse.json({
    titulo_ml: `${parsed.data.nome_produto} - Produto Qualidade`.slice(0, 60),
    titulo_shopee: `${parsed.data.nome_produto} - Melhor Preco | Entrega Rapida`.slice(0, 120),
    descricao: `Produto: ${parsed.data.nome_produto}\n\nDescricao gerada pela IA sera implementada na Fase 3.\n\nNicho: ${cliente.nicho ?? 'Nao informado'}\nEstilo: ${cliente.estiloDescricao ?? 'Nao informado'}`,
    categoria_ml_sugerida: 'Outros',
    categoria_shopee_id: 0,
    atributos: {},
  })
}
