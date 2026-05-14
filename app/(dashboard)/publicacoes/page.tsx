import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@/lib/db'
import { clientes, produtos, publicacoes } from '@/lib/db/schema'

type PublicacoesPageProps = {
  searchParams: {
    cliente_id?: string
    plataforma?: string
    status?: string
  }
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000))
}

function parseItemId(respostaApi: string | null) {
  if (!respostaApi) return ''

  try {
    const parsed = JSON.parse(respostaApi) as Record<string, unknown>
    return String(parsed.id ?? parsed.item_id ?? parsed.ml_item_id ?? parsed.shopee_item_id ?? '')
  } catch {
    return ''
  }
}

function platformBadge(platform: string) {
  return (
    <span className={`badge ${platform === 'ml' ? 'badge-ml' : 'badge-shopee'}`}>
      {platform === 'ml' ? 'ML' : 'Shopee'}
    </span>
  )
}

function statusBadge(status: string) {
  const classes = {
    sucesso: 'badge-success',
    erro: 'badge-error',
    pendente: 'badge-pending',
    publicando: 'badge-blue',
  }[status] ?? 'badge-pending'

  return <span className={`badge ${classes}`}>{status}</span>
}

export default async function PublicacoesPage({ searchParams }: PublicacoesPageProps) {
  const clientesList = await db.select().from(clientes).orderBy(desc(clientes.createdAt))
  const conditions = [
    searchParams.cliente_id ? eq(publicacoes.clienteId, searchParams.cliente_id) : undefined,
    searchParams.plataforma ? eq(publicacoes.plataforma, searchParams.plataforma) : undefined,
    searchParams.status ? eq(publicacoes.status, searchParams.status) : undefined,
  ].filter(Boolean)

  const rows = await db
    .select({
      id: publicacoes.id,
      plataforma: publicacoes.plataforma,
      status: publicacoes.status,
      respostaApi: publicacoes.respostaApi,
      erroMensagem: publicacoes.erroMensagem,
      tentativa: publicacoes.tentativa,
      createdAt: publicacoes.createdAt,
      produtoNome: produtos.nomeOriginal,
      clienteNome: clientes.nome,
    })
    .from(publicacoes)
    .innerJoin(produtos, eq(produtos.id, publicacoes.produtoId))
    .innerJoin(clientes, eq(clientes.id, publicacoes.clienteId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(publicacoes.createdAt))

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Monitoramento</p>
          <h1>Publicações</h1>
          <p className="page-subtitle">Acompanhe as tentativas de envio para cada marketplace.</p>
        </div>
      </div>

      <form className="panel filters">
        <label className="field">
          Cliente
          <select
            name="cliente_id"
            defaultValue={searchParams.cliente_id ?? ''}
          >
            <option value="">Todos</option>
            {clientesList.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Plataforma
          <select
            name="plataforma"
            defaultValue={searchParams.plataforma ?? ''}
          >
            <option value="">Todos</option>
            <option value="ml">ML</option>
            <option value="shopee">Shopee</option>
          </select>
        </label>

        <label className="field">
          Status
          <select
            name="status"
            defaultValue={searchParams.status ?? ''}
          >
            <option value="">Todos</option>
            <option value="sucesso">sucesso</option>
            <option value="erro">erro</option>
            <option value="pendente">pendente</option>
            <option value="publicando">publicando</option>
          </select>
        </label>

        <div className="actions-row">
          <button type="submit" className="btn btn-primary">
            Filtrar
          </button>
          <Link href="/publicacoes" className="btn btn-secondary">
            Limpar
          </Link>
        </div>
      </form>

      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Cliente</th>
              <th>Plataforma</th>
              <th>Status</th>
              <th>Item ID</th>
              <th>Data</th>
              <th className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  Nenhuma publicação encontrada.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const itemId = parseItemId(row.respostaApi)

                return (
                  <tr key={row.id}>
                    <td className="cell-title">{row.produtoNome}</td>
                    <td>{row.clienteNome}</td>
                    <td>{platformBadge(row.plataforma)}</td>
                    <td>{statusBadge(row.status)}</td>
                    <td>{itemId || '-'}</td>
                    <td>{formatDate(row.createdAt)}</td>
                    <td>
                      <div className="table-actions">
                        {itemId ? (
                          <a
                            href={row.plataforma === 'ml' ? `https://produto.mercadolivre.com.br/${itemId}` : '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary"
                          >
                            Ver anúncio
                          </a>
                        ) : null}
                        {row.status === 'erro' ? (
                          <form action={`/api/publicacoes/${row.id}/retry`} method="post">
                            <button className="btn btn-secondary">
                              Tentar novamente
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
