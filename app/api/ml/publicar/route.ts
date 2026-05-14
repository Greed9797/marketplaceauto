import { NextResponse } from 'next/server'
import { z } from 'zod'
import { publicarMlProduto } from '@/lib/ml/publish'

export const runtime = 'nodejs'

const schema = z.object({ produto_id: z.string().min(1) })

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'produto_id e obrigatorio.' }, { status: 400 })

  try {
    const item = await publicarMlProduto(parsed.data.produto_id)
    return NextResponse.json({ success: true, item })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Falha ao publicar no ML.' },
      { status: 500 },
    )
  }
}
