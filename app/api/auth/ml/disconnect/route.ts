import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tokensMl } from '@/lib/db/schema'

export const runtime = 'nodejs'

export async function DELETE(req: Request) {
  const clienteId = new URL(req.url).searchParams.get('cliente_id')
  if (!clienteId) return NextResponse.json({ error: 'cliente_id e obrigatorio.' }, { status: 400 })

  await db.delete(tokensMl).where(eq(tokensMl.clienteId, clienteId))
  return NextResponse.json({ success: true })
}
