import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Edit, Link2, PackagePlus } from 'lucide-react'
import { db } from '@/lib/db'
import { now } from '@/lib/db/helpers'
import { clientes, produtos, tokensMl, tokensShopee } from '@/lib/db/schema'
import { DisconnectTokenButton } from '../DisconnectTokenButton'

type ClienteDetalhePageProps = {
  params: Promise<{
    id: string
  }>
}

function formatDate(timestamp: number | null) {
  if (!timestamp) return '-'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000))
}

export default async function ClienteDetalhePage({ params }: ClienteDetalhePageProps) {
  const { id } = await params
  const [[cliente], [mlToken], [shopeeToken], produtosList] = await Promise.all([
    db.select().from(clientes).where(eq(clientes.id, id)).limit(1),
    db.select().from(tokensMl).where(eq(tokensMl.clienteId, id)).limit(1),
    db.select().from(tokensShopee).where(eq(tokensShopee.clienteId, id)).limit(1),
    db.select().from(produtos).where(eq(produtos.clienteId, id)).orderBy(desc(produtos.createdAt)),
  ])

  if (!cliente) notFound()

  const timestamp = now()
  const mlValid = Boolean(mlToken?.expiresAt && mlToken.expiresAt > timestamp)
  const shopeeValid = Boolean(shopeeToken?.expiresAt && shopeeToken.expiresAt > timestamp)

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Cliente</p>
          <h1>{cliente.nome}</h1>
          <p className="page-subtitle">{cliente.nicho ?? 'Nicho nao informado'}</p>
        </div>
        <Link href={`/clientes/${cliente.id}/editar`} className="btn btn-secondary">
          <Edit />
          Editar
        </Link>
      </div>

      <div className="stats-grid">
        <div className="metric-card">
          <p className="metric-label">Mercado Livre</p>
          <p className="metric-value">{mlValid ? 'Ativo' : 'Off'}</p>
          <p className="page-subtitle">Expira: {formatDate(mlToken?.expiresAt ?? null)}</p>
          {mlValid ? (
            <DisconnectTokenButton clienteId={cliente.id} plataforma="ml" />
          ) : (
            <a href={`/api/auth/ml?cliente_id=${cliente.id}`} className="btn btn-ml">
              <Link2 />
              Conectar ML
            </a>
          )}
        </div>
        <div className="metric-card">
          <p className="metric-label">Shopee</p>
          <p className="metric-value">{shopeeValid ? 'Ativo' : 'Off'}</p>
          <p className="page-subtitle">Shop ID: {shopeeToken?.shopId ?? '-'}</p>
          {shopeeValid ? (
            <DisconnectTokenButton clienteId={cliente.id} plataforma="shopee" />
          ) : (
            <a href={`/api/auth/shopee?cliente_id=${cliente.id}`} className="btn btn-shopee">
              <Link2 />
              Conectar Shopee
            </a>
          )}
        </div>
        <div className="metric-card">
          <p className="metric-label">Produtos</p>
          <p className="metric-value">{produtosList.length}</p>
          <Link href="/produtos/novo" className="btn btn-primary">
            <PackagePlus />
            Novo Produto
          </Link>
        </div>
      </div>

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Status</th>
              <th>Preco</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {produtosList.length === 0 ? (
              <tr>
                <td colSpan={4}>Nenhum produto deste cliente.</td>
              </tr>
            ) : (
              produtosList.map((produto) => (
                <tr key={produto.id}>
                  <td className="cell-title">{produto.nomeOriginal}</td>
                  <td>{produto.status}</td>
                  <td>{produto.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                  <td>{formatDate(produto.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
