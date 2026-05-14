import { ClienteForm } from '../ClienteForm'

export default function NovoClientePage() {
  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Cadastro</p>
          <h1>Novo Cliente</h1>
          <p className="page-subtitle">
          Configure o perfil usado para gerar copys e publicar nos marketplaces.
          </p>
        </div>
      </div>

      <ClienteForm />
    </section>
  )
}
