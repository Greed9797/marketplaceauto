import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { newId, now } from '@/lib/db/helpers'
import { tokensMl } from '@/lib/db/schema'
import { refreshToken } from './client'

export async function getValidMlToken(clienteId: string) {
  const [token] = await db.select().from(tokensMl).where(eq(tokensMl.clienteId, clienteId)).limit(1)

  if (!token) {
    throw new Error('Conta Mercado Livre nao conectada.')
  }

  if (token.expiresAt && token.expiresAt - now() > 1800) {
    return token.accessToken
  }

  const refreshed = await refreshToken(token.refreshToken)
  const timestamp = now()
  const expiresAt = timestamp + refreshed.expires_in

  await db
    .update(tokensMl)
    .set({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt,
      mlUserId: String(refreshed.user_id),
      updatedAt: timestamp,
    })
    .where(eq(tokensMl.id, token.id))

  return refreshed.access_token
}

export async function upsertMlToken(params: {
  clienteId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  mlUserId: string
}) {
  const [existing] = await db.select().from(tokensMl).where(eq(tokensMl.clienteId, params.clienteId)).limit(1)
  const timestamp = now()

  if (existing) {
    await db
      .update(tokensMl)
      .set({
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        expiresAt: params.expiresAt,
        mlUserId: params.mlUserId,
        updatedAt: timestamp,
      })
      .where(eq(tokensMl.id, existing.id))
    return
  }

  await db.insert(tokensMl).values({
    id: newId(),
    clienteId: params.clienteId,
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    expiresAt: params.expiresAt,
    mlUserId: params.mlUserId,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}
