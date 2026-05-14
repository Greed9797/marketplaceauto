import Link from 'next/link'
import { PackagePlus } from 'lucide-react'

export default function ProdutosPage() {
  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Catalogo</p>
          <h1>Produtos</h1>
          <p className="page-subtitle">Gerencie rascunhos e prepare novos anuncios para publicacao.</p>
        </div>
        <Link href="/produtos/novo" className="btn btn-primary">
          <PackagePlus />
          Novo Produto
        </Link>
      </div>

      <div className="panel empty-state">
        <div>
          <div className="empty-icon">
            <PackagePlus />
          </div>
          <h2>Nenhum produto listado</h2>
          <p>Use o formulario de novo produto para criar rascunhos ou iniciar publicacoes.</p>
          <Link href="/produtos/novo" className="btn btn-primary">
            Criar produto
          </Link>
        </div>
      </div>
    </section>
  )
}
