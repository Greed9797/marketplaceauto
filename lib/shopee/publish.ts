import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { newId, now } from '@/lib/db/helpers'
import { produtos, publicacoes } from '@/lib/db/schema'
import { buscarLogisticas, criarItem } from './api'
import { getValidShopeeToken } from './token'

export async function publicarShopeeProduto(produtoId: string) {
  const [produto] = await db.select().from(produtos).where(eq(produtos.id, produtoId)).limit(1)
  if (!produto) throw new Error('Produto nao encontrado.')
  const [existingLog] = await db
    .select()
    .from(publicacoes)
    .where(and(eq(publicacoes.produtoId, produtoId), eq(publicacoes.plataforma, 'shopee')))
    .limit(1)

  if (!existingLog) {
    await db.insert(publicacoes).values({
      id: newId(),
      produtoId,
      clienteId: produto.clienteId,
      plataforma: 'shopee',
      status: 'publicando',
      respostaApi: null,
      erroMensagem: null,
      tentativa: 1,
      createdAt: now(),
    })
  }

  try {
    const { accessToken, shopId } = await getValidShopeeToken(produto.clienteId)
    const logistics = await buscarLogisticas(accessToken, shopId)
    const logisticId = logistics.response?.logistic_channel_list?.find((item) => item.enabled)?.logistic_channel_id

    if (!produto.categoriaShopeeId) throw new Error('Categoria Shopee obrigatoria.')
    if (!logisticId) throw new Error('Nenhuma logistica Shopee ativa encontrada.')

    const payload = {
      original_price: produto.preco,
      description: produto.descricao || produto.nomeOriginal,
      weight: 0.5,
      item_name: (produto.tituloShopee || produto.nomeOriginal).slice(0, 120),
      item_status: 'NORMAL',
      image: { image_id_list: [] },
      category_id: produto.categoriaShopeeId,
      attribute_list: [],
      logistic_info: [{ logistic_id: logisticId, enabled: true, is_free: false }],
    }

    const item = await criarItem(accessToken, shopId, payload)
    const itemId = item.response?.item_id
    if (!itemId) throw new Error(`Shopee nao retornou item_id: ${JSON.stringify(item)}`)

    await db
      .update(produtos)
      .set({ shopeeItemId: itemId, payloadShopee: JSON.stringify(payload), status: 'publicado', updatedAt: now() })
      .where(eq(produtos.id, produtoId))
    await db
      .update(publicacoes)
      .set({ status: 'sucesso', respostaApi: JSON.stringify(item), erroMensagem: null })
      .where(and(eq(publicacoes.produtoId, produtoId), eq(publicacoes.plataforma, 'shopee')))

    return item
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida ao publicar na Shopee.'
    await db
      .update(produtos)
      .set({ status: 'erro', updatedAt: now() })
      .where(eq(produtos.id, produtoId))
    await db
      .update(publicacoes)
      .set({ status: 'erro', erroMensagem: message, respostaApi: JSON.stringify({ error: message }) })
      .where(and(eq(publicacoes.produtoId, produtoId), eq(publicacoes.plataforma, 'shopee')))
    throw error
  }
}
