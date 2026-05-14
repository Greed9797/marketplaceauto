import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { publicacoes } from '@/lib/db/schema'

export const runtime = 'nodejs'

type RetryRouteParams = {
  params: {
    id: string
  }
}

export async function POST(req: Request, { params }: RetryRouteParams) {
  const [publicacao] = await db.select().from(publicacoes).where(eq(publicacoes.id, params.id)).limit(1)

  if (!publicacao) {
    return NextResponse.json({ error: 'Publicacao nao encontrada.' }, { status: 404 })
  }

  await db
    .update(publicacoes)
    .set({
      status: 'pendente',
      erroMensagem: null,
      tentativa: publicacao.tentativa + 1,
    })
    .where(eq(publicacoes.id, params.id))

  return NextResponse.redirect(new URL('/publicacoes', req.url), { status: 303 })
}
