import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { produtos } from '@/lib/db/schema'
import { ProdutoEditForm } from './ProdutoEditForm'

type ProdutoEditarPageProps = {
  params: Promise<{
    id: string
  }>
}

export default async function ProdutoEditarPage({ params }: ProdutoEditarPageProps) {
  const { id } = await params
  const [produto] = await db.select().from(produtos).where(eq(produtos.id, id)).limit(1)

  if (!produto) notFound()

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Catalogo</p>
          <h1>Editar Produto</h1>
          <p className="page-subtitle">Ajuste dados, copy e categorias antes de publicar.</p>
        </div>
      </div>

      <ProdutoEditForm produto={produto} />
    </section>
  )
}
