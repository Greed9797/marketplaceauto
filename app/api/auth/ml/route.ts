import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/ml/client'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const clienteId = searchParams.get('cliente_id')

  if (!clienteId) {
    return NextResponse.json({ error: 'cliente_id e obrigatorio.' }, { status: 400 })
  }

  cookies().set('ml_oauth_cliente_id', clienteId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })

  return NextResponse.redirect(getAuthUrl())
}
