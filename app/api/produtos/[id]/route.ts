import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { now } from '@/lib/db/helpers'
import { produtos } from '@/lib/db/schema'

export const runtime = 'nodejs'

type ProdutoRouteParams = {
  params: {
    id: string
  }
}

const produtoUpdateSchema = z.object({
  nome_original: z.string().trim().min(1, 'Nome do produto e obrigatorio.'),
  foto_url: z.string().optional().default(''),
  titulo_ml: z.string().optional().default(''),
  titulo_shopee: z.string().optional().default(''),
  descricao: z.string().optional().default(''),
  categoria_ml_id: z.string().optional().default(''),
  categoria_shopee_id: z.coerce.number().optional().default(0),
  preco: z.coerce.number().positive('Preco deve ser maior que zero.'),
  quantidade: z.coerce.number().int().positive().default(1),
  condicao: z.enum(['new', 'used', 'not_specified']).default('new'),
})

export async function PUT(req: Request, { params }: ProdutoRouteParams) {
  const parsed = produtoUpdateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados invalidos.' }, { status: 400 })
  }

  await db
    .update(produtos)
    .set({
      nomeOriginal: parsed.data.nome_original,
      fotoUrl: parsed.data.foto_url || null,
      tituloMl: parsed.data.titulo_ml || null,
      tituloShopee: parsed.data.titulo_shopee || null,
      descricao: parsed.data.descricao || null,
      categoriaMlId: parsed.data.categoria_ml_id || null,
      categoriaShopeeId: parsed.data.categoria_shopee_id || null,
      preco: parsed.data.preco,
      quantidade: parsed.data.quantidade,
      condicao: parsed.data.condicao,
      updatedAt: now(),
    })
    .where(eq(produtos.id, params.id))

  return NextResponse.json({ success: true, id: params.id })
}
