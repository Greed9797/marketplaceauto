'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { Minus, Plus, Save } from 'lucide-react'

type ClienteFormValues = {
  nome: string
  nicho: string
  estilo_descricao: string
  exemplos_titulos: string[]
  exemplos_descricoes: string[]
  dados_fiscais: {
    cnpj: string
    razao_social: string
    ie: string
  }
}

type ClienteFormProps = {
  clienteId?: string
  initialValues?: ClienteFormValues
}

const emptyValues: ClienteFormValues = {
  nome: '',
  nicho: '',
  estilo_descricao: '',
  exemplos_titulos: [''],
  exemplos_descricoes: [''],
  dados_fiscais: {
    cnpj: '',
    razao_social: '',
    ie: '',
  },
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function maskCnpj(value: string) {
  const digits = onlyDigits(value).slice(0, 14)

  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function ClienteForm({ clienteId, initialValues }: ClienteFormProps) {
  const router = useRouter()
  const [values, setValues] = useState<ClienteFormValues>(initialValues ?? emptyValues)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const editing = Boolean(clienteId)

  function updateField(field: keyof ClienteFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function updateFiscal(field: keyof ClienteFormValues['dados_fiscais'], value: string) {
    setValues((current) => ({
      ...current,
      dados_fiscais: {
        ...current.dados_fiscais,
        [field]: field === 'cnpj' ? maskCnpj(value) : value,
      },
    }))
  }

  function updateList(field: 'exemplos_titulos' | 'exemplos_descricoes', index: number, value: string) {
    setValues((current) => ({
      ...current,
      [field]: current[field].map((item, itemIndex) => (itemIndex === index ? value : item)),
    }))
  }

  function addListItem(field: 'exemplos_titulos' | 'exemplos_descricoes') {
    setValues((current) => ({ ...current, [field]: [...current[field], ''] }))
  }

  function removeListItem(field: 'exemplos_titulos' | 'exemplos_descricoes', index: number) {
    setValues((current) => ({
      ...current,
      [field]: current[field].filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    const endpoint = editing ? `/api/clientes/${clienteId}` : '/api/clientes'
    const method = editing ? 'PUT' : 'POST'

    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        exemplos_titulos: values.exemplos_titulos.filter(Boolean),
        exemplos_descricoes: values.exemplos_descricoes.filter(Boolean),
      }),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? 'Nao foi possivel salvar o cliente.')
      setSubmitting(false)
      return
    }

    router.push('/clientes')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="form-stack">
      {error ? (
        <div className="error-box">
          {error}
        </div>
      ) : null}

      <div className="panel form-panel">
        <div className="form-grid">
        <label className="field">
          Nome
          <input
            required
            value={values.nome}
            onChange={(event) => updateField('nome', event.target.value)}
          />
        </label>

        <label className="field">
          Nicho
          <input
            required
            value={values.nicho}
            onChange={(event) => updateField('nicho', event.target.value)}
            placeholder="moda feminina"
          />
        </label>

        <label className="field field-full">
          Estilo de descricao
          <textarea
            required
            rows={4}
            value={values.estilo_descricao}
            onChange={(event) => updateField('estilo_descricao', event.target.value)}
            placeholder="tecnico, objetivo, sem emojis"
          />
        </label>
        </div>
      </div>

      <div className="panel form-panel">
        <div className="section-bar">
          <h2>Exemplos de titulos</h2>
          <button
            type="button"
            onClick={() => addListItem('exemplos_titulos')}
            className="btn btn-secondary"
          >
            <Plus />
            Adicionar
          </button>
        </div>

        <div className="form-stack">
          {values.exemplos_titulos.map((item, index) => (
            <div key={index} className="list-row">
              <input
                value={item}
                onChange={(event) => updateList('exemplos_titulos', index, event.target.value)}
              />
              <button
                type="button"
                onClick={() => removeListItem('exemplos_titulos', index)}
                className="btn btn-secondary"
              >
                <Minus />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="panel form-panel">
        <div className="section-bar">
          <h2>Exemplos de descricoes</h2>
          <button
            type="button"
            onClick={() => addListItem('exemplos_descricoes')}
            className="btn btn-secondary"
          >
            <Plus />
            Adicionar
          </button>
        </div>

        <div className="form-stack">
          {values.exemplos_descricoes.map((item, index) => (
            <div key={index} className="list-row">
              <textarea
                rows={3}
                value={item}
                onChange={(event) => updateList('exemplos_descricoes', index, event.target.value)}
              />
              <button
                type="button"
                onClick={() => removeListItem('exemplos_descricoes', index)}
                className="btn btn-secondary"
              >
                <Minus />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="panel form-panel">
        <div className="form-grid-3">
        <label className="field">
          CNPJ
          <input
            value={values.dados_fiscais.cnpj}
            onChange={(event) => updateFiscal('cnpj', event.target.value)}
          />
        </label>

        <label className="field">
          Razao Social
          <input
            value={values.dados_fiscais.razao_social}
            onChange={(event) => updateFiscal('razao_social', event.target.value)}
          />
        </label>

        <label className="field">
          IE
          <input
            value={values.dados_fiscais.ie}
            onChange={(event) => updateFiscal('ie', event.target.value)}
          />
        </label>
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="btn btn-primary"
      >
        <Save />
        {submitting ? 'Salvando...' : editing ? 'Salvar alteracoes' : 'Criar cliente'}
      </button>
    </form>
  )
}
