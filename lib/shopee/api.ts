import { getShopeeHost, nowTimestamp, sign } from './client'

async function shopeeFetch<T>(
  accessToken: string,
  shopId: number,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const host = getShopeeHost()
  const timestamp = nowTimestamp()
  const partnerId = process.env.SHOPEE_PARTNER_ID!
  const url = new URL(`${host}${path}`)
  url.searchParams.set('partner_id', partnerId)
  url.searchParams.set('timestamp', String(timestamp))
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('shop_id', String(shopId))
  url.searchParams.set('sign', sign(path, timestamp, accessToken, shopId))

  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  const data = await response.json()
  if (data.error) throw new Error(JSON.stringify(data))
  return data
}

export async function uploadImagem(accessToken: string, shopId: number, imagePath: string) {
  return shopeeFetch(accessToken, shopId, '/api/v2/media_space/upload_image', {
    method: 'POST',
    body: JSON.stringify({ image: imagePath }),
  })
}

export async function buscarCategorias(accessToken: string, shopId: number) {
  return shopeeFetch(accessToken, shopId, '/api/v2/product/get_category')
}

export async function buscarAtributos(accessToken: string, shopId: number, categoryId: number) {
  return shopeeFetch(accessToken, shopId, `/api/v2/product/get_attribute_tree?category_id=${categoryId}`)
}

export async function buscarLogisticas(accessToken: string, shopId: number) {
  return shopeeFetch<{ response?: { logistic_channel_list?: Array<{ logistic_channel_id: number; enabled: boolean }> } }>(
    accessToken,
    shopId,
    '/api/v2/logistics/get_channel_list',
  )
}

export async function criarItem(accessToken: string, shopId: number, payload: Record<string, unknown>) {
  return shopeeFetch<{ response?: { item_id?: number } }>(accessToken, shopId, '/api/v2/product/add_item', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function atualizarStatus(
  accessToken: string,
  shopId: number,
  itemId: number,
  itemStatus: 'NORMAL' | 'UNLIST',
) {
  return shopeeFetch(accessToken, shopId, '/api/v2/product/update_item', {
    method: 'POST',
    body: JSON.stringify({ item_id: itemId, item_status: itemStatus }),
  })
}
