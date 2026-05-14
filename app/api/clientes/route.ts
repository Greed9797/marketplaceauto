import { desc, gt } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { newId, now } from '@/lib/db/helpers'
import { clientes, tokensMl, tokensShopee } from '@/lib/db/schema'

export const runtime = 'nodejs'

const clienteSchema = z.object({
  nome: z.string().trim().min(1, 'Nome e obrigatorio.'),
  nicho: z.string().trim().min(1, 'Nicho e obrigatorio.'),
  estilo_descricao: z.string().trim().min(1, 'Estilo de descricao e obrigatorio.'),
  exemplos_titulos: z.array(z.string()).default([]),
  exemplos_descricoes: z.array(z.string()).default([]),
  dados_fiscais: z
    .object({
      cnpj: z.string().default(''),
      razao_social: z.string().default(''),
      ie: z.string().default(''),
    })
    .default({ cnpj: '', razao_social: '', ie: '' }),
})

export async function GET() {
  const timestamp = now()
  const [clientesList, mlTokens, shopeeTokens] = await Promise.all([
    db.select().from(clientes).orderBy(desc(clientes.createdAt)),
    db.select({ clienteId: tokensMl.clienteId }).from(tokensMl).where(gt(tokensMl.expiresAt, timestamp)),
    db
      .select({ clienteId: tokensShopee.clienteId })
      .from(tokensShopee)
      .where(gt(tokensShopee.expiresAt, timestamp)),
  ])

  const mlConnected = new Set(mlTokens.map((token) => token.clienteId))
  const shopeeConnected = new Set(shopeeTokens.map((token) => token.clienteId))

  return NextResponse.json(
    clientesList.map((cliente) => ({
      id: cliente.id,
      nome: cliente.nome,
      nicho: cliente.nicho,
      estilo_descricao: cliente.estiloDescricao,
      exemplos_titulos: cliente.exemplosTitulos ? JSON.parse(cliente.exemplosTitulos) : [],
      exemplos_descricoes: cliente.exemplosDescricoes ? JSON.parse(cliente.exemplosDescricoes) : [],
      dados_fiscais: cliente.dadosFiscais ? JSON.parse(cliente.dadosFiscais) : {},
      ml_conectado: mlConnected.has(cliente.id),
      shopee_conectado: shopeeConnected.has(cliente.id),
      created_at: cliente.createdAt,
      updated_at: cliente.updatedAt,
    })),
  )
}

export async function POST(req: Request) {
  const body = await req.json()
  const parsed = clienteSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados invalidos.' }, { status: 400 })
  }

  const id = newId()
  const timestamp = now()

  await db.insert(clientes).values({
    id,
    nome: parsed.data.nome,
    nicho: parsed.data.nicho,
    estiloDescricao: parsed.data.estilo_descricao,
    exemplosTitulos: JSON.stringify(parsed.data.exemplos_titulos.filter(Boolean)),
    exemplosDescricoes: JSON.stringify(parsed.data.exemplos_descricoes.filter(Boolean)),
    dadosFiscais: JSON.stringify(parsed.data.dados_fiscais),
    ativo: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  })

  return NextResponse.json({ success: true, id })
}
