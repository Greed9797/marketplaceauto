import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { now } from '@/lib/db/helpers'
import { clientes, produtos, publicacoes, tokensMl, tokensShopee } from '@/lib/db/schema'

export const runtime = 'nodejs'

type ClienteRouteParams = {
  params: {
    id: string
  }
}

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

export async function PUT(req: Request, { params }: ClienteRouteParams) {
  const body = await req.json()
  const parsed = clienteSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados invalidos.' }, { status: 400 })
  }

  await db
    .update(clientes)
    .set({
      nome: parsed.data.nome,
      nicho: parsed.data.nicho,
      estiloDescricao: parsed.data.estilo_descricao,
      exemplosTitulos: JSON.stringify(parsed.data.exemplos_titulos.filter(Boolean)),
      exemplosDescricoes: JSON.stringify(parsed.data.exemplos_descricoes.filter(Boolean)),
      dadosFiscais: JSON.stringify(parsed.data.dados_fiscais),
      updatedAt: now(),
    })
    .where(eq(clientes.id, params.id))

  return NextResponse.json({ success: true, id: params.id })
}

export async function DELETE(_req: Request, { params }: ClienteRouteParams) {
  db.transaction((tx) => {
    tx.delete(publicacoes).where(eq(publicacoes.clienteId, params.id)).run()
    tx.delete(produtos).where(eq(produtos.clienteId, params.id)).run()
    tx.delete(tokensMl).where(eq(tokensMl.clienteId, params.id)).run()
    tx.delete(tokensShopee).where(eq(tokensShopee.clienteId, params.id)).run()
    tx.delete(clientes).where(eq(clientes.id, params.id)).run()
  })

  return NextResponse.json({ success: true })
}

export async function POST(req: Request, context: ClienteRouteParams) {
  const formData = await req.formData()

  if (formData.get('_method') === 'DELETE') {
    await DELETE(req, context)
    return NextResponse.redirect(new URL('/clientes', req.url), { status: 303 })
  }

  return NextResponse.json({ error: 'Metodo nao suportado.' }, { status: 405 })
}
