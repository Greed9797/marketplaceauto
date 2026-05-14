import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { now } from '@/lib/db/helpers'
import { exchangeCode } from '@/lib/shopee/client'
import { upsertShopeeToken } from '@/lib/shopee/token'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const shopId = Number(url.searchParams.get('shop_id'))
  const clienteId = cookies().get('shopee_oauth_cliente_id')?.value

  if (!code || !shopId || !clienteId) {
    return NextResponse.redirect(new URL('/clientes?erro=oauth_shopee', req.url))
  }

  try {
    const token = await exchangeCode(code, shopId)
    await upsertShopeeToken({
      clienteId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: now() + token.expire_in,
      shopId,
    })
    cookies().delete('shopee_oauth_cliente_id')
    return NextResponse.redirect(new URL('/clientes', req.url))
  } catch (error) {
    const redirect = new URL('/clientes', req.url)
    redirect.searchParams.set('erro', error instanceof Error ? error.message : 'oauth_shopee')
    return NextResponse.redirect(redirect)
  }
}
