import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { newId, now } from '@/lib/db/helpers'
import { tokensShopee } from '@/lib/db/schema'
import { refreshToken } from './client'

export async function getValidShopeeToken(clienteId: string) {
  const [token] = await db.select().from(tokensShopee).where(eq(tokensShopee.clienteId, clienteId)).limit(1)

  if (!token || !token.shopId) {
    throw new Error('Conta Shopee nao conectada.')
  }

  if (token.expiresAt && token.expiresAt - now() > 1800) {
    return { accessToken: token.accessToken, shopId: token.shopId }
  }

  const refreshed = await refreshToken(token.refreshToken, token.shopId)
  const timestamp = now()
  const expiresAt = timestamp + refreshed.expire_in

  await db
    .update(tokensShopee)
    .set({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt,
      updatedAt: timestamp,
    })
    .where(eq(tokensShopee.id, token.id))

  return { accessToken: refreshed.access_token, shopId: token.shopId }
}

export async function upsertShopeeToken(params: {
  clienteId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  shopId: number
}) {
  const [existing] = await db.select().from(tokensShopee).where(eq(tokensShopee.clienteId, params.clienteId)).limit(1)
  const timestamp = now()

  if (existing) {
    await db
      .update(tokensShopee)
      .set({
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        expiresAt: params.expiresAt,
        shopId: params.shopId,
        updatedAt: timestamp,
      })
      .where(eq(tokensShopee.id, existing.id))
    return
  }

  await db.insert(tokensShopee).values({
    id: newId(),
    clienteId: params.clienteId,
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    expiresAt: params.expiresAt,
    shopId: params.shopId,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}
