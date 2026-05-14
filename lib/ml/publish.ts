import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { newId, now } from '@/lib/db/helpers'
import { produtos, publicacoes } from '@/lib/db/schema'
import { adicionarDescricao, buscarCategoria, criarItem, uploadImagem } from './api'
import { getValidMlToken } from './token'

export async function publicarMlProduto(produtoId: string) {
  const [produto] = await db.select().from(produtos).where(eq(produtos.id, produtoId)).limit(1)
  if (!produto) throw new Error('Produto nao encontrado.')
  const [existingLog] = await db
    .select()
    .from(publicacoes)
    .where(and(eq(publicacoes.produtoId, produtoId), eq(publicacoes.plataforma, 'ml')))
    .limit(1)

  if (!existingLog) {
    await db.insert(publicacoes).values({
      id: newId(),
      produtoId,
      clienteId: produto.clienteId,
      plataforma: 'ml',
      status: 'publicando',
      respostaApi: null,
      erroMensagem: null,
      tentativa: 1,
      createdAt: now(),
    })
  }

  try {
    const token = await getValidMlToken(produto.clienteId)
    const categoryId =
      produto.categoriaMlId && produto.categoriaMlId.startsWith('MLB')
        ? produto.categoriaMlId
        : await buscarCategoria(token, produto.tituloMl || produto.nomeOriginal)

    if (!categoryId) throw new Error('Categoria ML nao encontrada.')

    const pictures = produto.fotoUrl ? [{ source: produto.fotoUrl }] : []
    if (produto.fotoUrl?.startsWith('/')) {
      pictures[0] = { source: produto.fotoUrl }
    } else if (produto.fotoUrl) {
      const uploaded = await uploadImagem(token, produto.fotoUrl)
      pictures[0] = { source: uploaded.id }
    }

    const payload = {
      title: (produto.tituloMl || produto.nomeOriginal).slice(0, 60),
      category_id: categoryId,
      price: produto.preco,
      currency_id: 'BRL',
      available_quantity: produto.quantidade,
      buying_mode: 'buy_it_now',
      listing_type_id: 'gold_special',
      condition: produto.condicao || 'not_specified',
      pictures,
      shipping: { mode: 'me2', local_pick_up: false, free_shipping: false },
      attributes: [],
    }

    const item = await criarItem(token, payload)
    if (produto.descricao) await adicionarDescricao(token, item.id, produto.descricao)

    await db
      .update(produtos)
      .set({ mlItemId: item.id, payloadMl: JSON.stringify(payload), status: 'publicado', updatedAt: now() })
      .where(eq(produtos.id, produtoId))
    await db
      .update(publicacoes)
      .set({ status: 'sucesso', respostaApi: JSON.stringify(item), erroMensagem: null })
      .where(and(eq(publicacoes.produtoId, produtoId), eq(publicacoes.plataforma, 'ml')))

    return item
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida ao publicar no ML.'
    await db
      .update(produtos)
      .set({ status: 'erro', updatedAt: now() })
      .where(eq(produtos.id, produtoId))
    await db
      .update(publicacoes)
      .set({ status: 'erro', erroMensagem: message, respostaApi: JSON.stringify({ error: message }) })
      .where(and(eq(publicacoes.produtoId, produtoId), eq(publicacoes.plataforma, 'ml')))
    throw error
  }
}
