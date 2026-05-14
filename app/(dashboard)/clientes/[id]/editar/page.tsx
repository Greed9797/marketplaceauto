import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { ClienteForm } from '../../ClienteForm'
import { db } from '@/lib/db'
import { clientes } from '@/lib/db/schema'

type EditarClientePageProps = {
  params: Promise<{
    id: string
  }>
}

function parseJsonArray(value: string | null) {
  if (!value) return ['']

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && parsed.length ? parsed.map(String) : ['']
  } catch {
    return ['']
  }
}

function parseDadosFiscais(value: string | null) {
  if (!value) {
    return { cnpj: '', razao_social: '', ie: '' }
  }

  try {
    const parsed = JSON.parse(value) as Partial<{ cnpj: string; razao_social: string; ie: string }>
    return {
      cnpj: parsed.cnpj ?? '',
      razao_social: parsed.razao_social ?? '',
      ie: parsed.ie ?? '',
    }
  } catch {
    return { cnpj: '', razao_social: '', ie: '' }
  }
}

export default async function EditarClientePage({ params }: EditarClientePageProps) {
  const { id } = await params
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, id)).limit(1)

  if (!cliente) {
    notFound()
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Cadastro</p>
          <h1>Editar Cliente</h1>
          <p className="page-subtitle">Atualize o perfil comercial e fiscal do cliente.</p>
        </div>
      </div>

      <ClienteForm
        clienteId={cliente.id}
        initialValues={{
          nome: cliente.nome,
          nicho: cliente.nicho ?? '',
          estilo_descricao: cliente.estiloDescricao ?? '',
          exemplos_titulos: parseJsonArray(cliente.exemplosTitulos),
          exemplos_descricoes: parseJsonArray(cliente.exemplosDescricoes),
          dados_fiscais: parseDadosFiscais(cliente.dadosFiscais),
        }}
      />
    </section>
  )
}
