import { and, desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { newId, now } from '@/lib/db/helpers'
import { clientes, produtos, publicacoes } from '@/lib/db/schema'
import { publicarMlProduto } from '@/lib/ml/publish'
import { publicarShopeeProduto } from '@/lib/shopee/publish'

export const runtime = 'nodejs'

const produtoSchema = z.object({
  cliente_id: z.string().min(1, 'Cliente e obrigatorio.'),
  nome_original: z.string().trim().min(1, 'Nome do produto e obrigatorio.'),
  foto_url: z.string().optional().default(''),
  status: z.enum(['rascunho', 'pendente', 'publicando', 'publicado', 'erro']).default('rascunho'),
  titulo_ml: z.string().optional().default(''),
  titulo_shopee: z.string().optional().default(''),
  descricao: z.string().optional().default(''),
  categoria_ml_id: z.string().optional().default(''),
  categoria_shopee_id: z.coerce.number().optional().default(0),
  preco: z.coerce.number().positive('Preco deve ser maior que zero.'),
  quantidade: z.coerce.number().int().positive().default(1),
  condicao: z.enum(['new', 'used', 'not_specified']).default('new'),
  atributos: z.record(z.string(), z.unknown()).optional().default({}),
  publicar_ml: z.boolean().optional().default(false),
  publicar_shopee: z.boolean().optional().default(false),
})

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const clienteId = searchParams.get('cliente_id')
  const conditions = clienteId ? [eq(produtos.clienteId, clienteId)] : []

  const rows = await db
    .select({
      id: produtos.id,
      clienteId: produtos.clienteId,
      clienteNome: clientes.nome,
      nomeOriginal: produtos.nomeOriginal,
      fotoUrl: produtos.fotoUrl,
      status: produtos.status,
      preco: produtos.preco,
      quantidade: produtos.quantidade,
      condicao: produtos.condicao,
      createdAt: produtos.createdAt,
    })
    .from(produtos)
    .innerJoin(clientes, eq(clientes.id, produtos.clienteId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(produtos.createdAt))

  return NextResponse.json(rows)
}

export async function POST(req: Request) {
  const body = await req.json()
  const parsed = produtoSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados invalidos.' }, { status: 400 })
  }

  const id = newId()
  const timestamp = now()
  const shouldPublish = parsed.data.publicar_ml || parsed.data.publicar_shopee
  const status = shouldPublish ? 'pendente' : parsed.data.status

  db.transaction((tx) => {
    tx.insert(produtos).values({
      id,
      clienteId: parsed.data.cliente_id,
      nomeOriginal: parsed.data.nome_original,
      fotoUrl: parsed.data.foto_url || null,
      status,
      tituloMl: parsed.data.titulo_ml || null,
      tituloShopee: parsed.data.titulo_shopee || null,
      descricao: parsed.data.descricao || null,
      categoriaMlId: parsed.data.categoria_ml_id || null,
      categoriaShopeeId: parsed.data.categoria_shopee_id || null,
      preco: parsed.data.preco,
      quantidade: parsed.data.quantidade,
      condicao: parsed.data.condicao,
      atributos: JSON.stringify(parsed.data.atributos),
      payloadMl: null,
      payloadShopee: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run()

    const logs = [
      parsed.data.publicar_ml ? 'ml' : null,
      parsed.data.publicar_shopee ? 'shopee' : null,
    ].filter((platform): platform is 'ml' | 'shopee' => Boolean(platform))

    for (const plataforma of logs) {
      tx.insert(publicacoes).values({
        id: newId(),
        produtoId: id,
        clienteId: parsed.data.cliente_id,
        plataforma,
        status: 'pendente',
        respostaApi: JSON.stringify({
          message: 'Publicacao sera executada nas fases seguintes.',
          produto_id: id,
          plataforma,
        }),
        erroMensagem: null,
        tentativa: 1,
        createdAt: timestamp,
      }).run()
    }
  })

  const publishErrors: string[] = []

  if (parsed.data.publicar_ml) {
    await publicarMlProduto(id).catch((error) => {
      publishErrors.push(error instanceof Error ? error.message : 'Falha ao publicar no ML.')
    })
  }

  if (parsed.data.publicar_shopee) {
    await publicarShopeeProduto(id).catch((error) => {
      publishErrors.push(error instanceof Error ? error.message : 'Falha ao publicar na Shopee.')
    })
  }

  return NextResponse.json({ success: true, id, publishErrors })
}
