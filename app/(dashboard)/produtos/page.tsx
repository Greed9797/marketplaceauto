import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { Edit, PackagePlus } from 'lucide-react'
import { db } from '@/lib/db'
import { clientes, produtos } from '@/lib/db/schema'
import { PublishProdutoButtons } from './PublishProdutoButtons'

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000))
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function statusBadge(status: string) {
  const classes = {
    rascunho: 'badge-pending',
    pendente: 'badge-blue',
    publicando: 'badge-blue',
    publicado: 'badge-success',
    erro: 'badge-error',
  }[status] ?? 'badge-pending'

  return <span className={`badge ${classes}`}>{status}</span>
}

export default async function ProdutosPage() {
  const rows = await db
    .select({
      id: produtos.id,
      nomeOriginal: produtos.nomeOriginal,
      status: produtos.status,
      preco: produtos.preco,
      clienteNome: clientes.nome,
      createdAt: produtos.createdAt,
    })
    .from(produtos)
    .innerJoin(clientes, eq(clientes.id, produtos.clienteId))
    .orderBy(desc(produtos.createdAt))

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

      {rows.length === 0 ? (
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
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Cliente</th>
                <th>Status</th>
                <th>Preco</th>
                <th>Data</th>
                <th className="text-right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="cell-title">{row.nomeOriginal}</td>
                  <td>{row.clienteNome}</td>
                  <td>{statusBadge(row.status)}</td>
                  <td>{formatMoney(row.preco)}</td>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>
                    <div className="table-actions">
                      <Link href={`/produtos/${row.id}/editar`} className="btn btn-secondary">
                        <Edit />
                        Editar
                      </Link>
                      <PublishProdutoButtons produtoId={row.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
