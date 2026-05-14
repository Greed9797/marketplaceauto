import { desc, gt } from 'drizzle-orm'
import Link from 'next/link'
import { Edit, Link2, Plus } from 'lucide-react'
import { db } from '@/lib/db'
import { now } from '@/lib/db/helpers'
import { clientes, tokensMl, tokensShopee } from '@/lib/db/schema'
import { DeleteClienteButton } from './DeleteClienteButton'
import { DisconnectTokenButton } from './DisconnectTokenButton'

export default async function ClientesPage() {
  const timestamp = now()
  const [clientesList, mlTokens, shopeeTokens] = await Promise.all([
    db.select().from(clientes).orderBy(desc(clientes.createdAt)),
    db.select({ clienteId: tokensMl.clienteId }).from(tokensMl).where(gt(tokensMl.expiresAt, timestamp)),
    db
      .select({ clienteId: tokensShopee.clienteId })
      .from(tokensShopee)
      .where(gt(tokensShopee.expiresAt, timestamp)),
  ])

  const mlConnected = new Set(mlTokens.map((token) => token.clienteId))
  const shopeeConnected = new Set(shopeeTokens.map((token) => token.clienteId))
  const connectedCount = clientesList.filter(
    (cliente) => mlConnected.has(cliente.id) || shopeeConnected.has(cliente.id),
  ).length

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operacao multi-cliente</p>
          <h1>Clientes</h1>
          <p className="page-subtitle">Gerencie perfis comerciais, padroes de copy e conexoes por marketplace.</p>
        </div>

        <Link
          href="/clientes/novo"
          className="btn btn-primary"
        >
          <Plus />
          Novo Cliente
        </Link>
      </div>

      <div className="stats-grid">
        <div className="metric-card">
          <p className="metric-label">Clientes</p>
          <p className="metric-value">{clientesList.length}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Com integracao</p>
          <p className="metric-value">{connectedCount}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Pendentes</p>
          <p className="metric-value">{clientesList.length - connectedCount}</p>
        </div>
      </div>

      {clientesList.length === 0 ? (
        <div className="panel empty-state">
          <div>
            <div className="empty-icon">
              <Plus />
            </div>
            <h2>Nenhum cliente cadastrado</h2>
            <p>Crie o primeiro perfil para liberar o cadastro de produtos e a geracao de copy por IA.</p>
          </div>
          <Link
            href="/clientes/novo"
            className="btn btn-primary"
          >
            <Plus />
            Criar primeiro cliente
          </Link>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Nicho</th>
                <th>ML conectado</th>
                <th>Shopee conectado</th>
                <th className="text-right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {clientesList.map((cliente) => (
                <tr key={cliente.id}>
                  <td className="cell-title">
                    <Link href={`/clientes/${cliente.id}`}>{cliente.nome}</Link>
                  </td>
                  <td>{cliente.nicho ?? '-'}</td>
                  <td>
                    <span className={`connection ${mlConnected.has(cliente.id) ? 'connection-on' : 'connection-off'}`}>
                      {mlConnected.has(cliente.id) ? '✓' : '✗'}
                      {mlConnected.has(cliente.id) ? 'Ativo' : 'Nao conectado'}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`connection ${shopeeConnected.has(cliente.id) ? 'connection-on' : 'connection-off'}`}
                    >
                      {shopeeConnected.has(cliente.id) ? '✓' : '✗'}
                      {shopeeConnected.has(cliente.id) ? 'Ativo' : 'Nao conectado'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      {mlConnected.has(cliente.id) ? (
                        <DisconnectTokenButton clienteId={cliente.id} plataforma="ml" />
                      ) : (
                        <a href={`/api/auth/ml?cliente_id=${cliente.id}`} className="btn btn-ml">
                          <Link2 />
                          Conectar ML
                        </a>
                      )}
                      {shopeeConnected.has(cliente.id) ? (
                        <DisconnectTokenButton clienteId={cliente.id} plataforma="shopee" />
                      ) : (
                        <a href={`/api/auth/shopee?cliente_id=${cliente.id}`} className="btn btn-shopee">
                          <Link2 />
                          Conectar Shopee
                        </a>
                      )}
                      <Link
                        href={`/clientes/${cliente.id}/editar`}
                        className="btn btn-secondary"
                      >
                        <Edit />
                        Editar
                      </Link>
                      <DeleteClienteButton id={cliente.id} />
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
