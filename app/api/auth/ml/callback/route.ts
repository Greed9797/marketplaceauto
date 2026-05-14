import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { exchangeCode, getMe } from '@/lib/ml/client'
import { now } from '@/lib/db/helpers'
import { upsertMlToken } from '@/lib/ml/token'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const clienteId = cookies().get('ml_oauth_cliente_id')?.value

  if (!code || !clienteId) {
    return NextResponse.redirect(new URL('/clientes?erro=oauth_ml', req.url))
  }

  try {
    const token = await exchangeCode(code)
    const me = await getMe(token.access_token)
    await upsertMlToken({
      clienteId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: now() + token.expires_in,
      mlUserId: String(me.id ?? token.user_id),
    })
    cookies().delete('ml_oauth_cliente_id')
    return NextResponse.redirect(new URL('/clientes', req.url))
  } catch (error) {
    const redirect = new URL('/clientes', req.url)
    redirect.searchParams.set('erro', error instanceof Error ? error.message : 'oauth_ml')
    return NextResponse.redirect(redirect)
  }
}
