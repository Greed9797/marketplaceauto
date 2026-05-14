'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { Save } from 'lucide-react'
import { PublishProdutoButtons } from '../../PublishProdutoButtons'

type ProdutoEditFormProps = {
  produto: {
    id: string
    nomeOriginal: string
    fotoUrl: string | null
    tituloMl: string | null
    tituloShopee: string | null
    descricao: string | null
    categoriaMlId: string | null
    categoriaShopeeId: number | null
    preco: number
    quantidade: number
    condicao: string | null
  }
}

export function ProdutoEditForm({ produto }: ProdutoEditFormProps) {
  const router = useRouter()
  const [values, setValues] = useState({
    nome_original: produto.nomeOriginal,
    foto_url: produto.fotoUrl ?? '',
    titulo_ml: produto.tituloMl ?? '',
    titulo_shopee: produto.tituloShopee ?? '',
    descricao: produto.descricao ?? '',
    categoria_ml_id: produto.categoriaMlId ?? '',
    categoria_shopee_id: String(produto.categoriaShopeeId ?? 0),
    preco: String(produto.preco),
    quantidade: String(produto.quantidade),
    condicao: (produto.condicao ?? 'new') as 'new' | 'used' | 'not_specified',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function setField(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    const response = await fetch(`/api/produtos/${produto.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? 'Nao foi possivel salvar o produto.')
      setSubmitting(false)
      return
    }

    router.push('/produtos')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="form-stack">
      {error ? <div className="error-box">{error}</div> : null}

      <div className="panel form-panel">
        <div className="form-grid">
          <label className="field">
            Nome do produto
            <input value={values.nome_original} onChange={(event) => setField('nome_original', event.target.value)} />
          </label>
          <label className="field">
            Foto URL
            <input value={values.foto_url} onChange={(event) => setField('foto_url', event.target.value)} />
          </label>
          <label className="field">
            Preco
            <input type="number" step="0.01" value={values.preco} onChange={(event) => setField('preco', event.target.value)} />
          </label>
          <label className="field">
            Quantidade
            <input type="number" value={values.quantidade} onChange={(event) => setField('quantidade', event.target.value)} />
          </label>
          <label className="field">
            Condicao
            <select value={values.condicao} onChange={(event) => setField('condicao', event.target.value)}>
              <option value="new">new</option>
              <option value="used">used</option>
              <option value="not_specified">not_specified</option>
            </select>
          </label>
        </div>
      </div>

      <div className="panel form-panel">
        <div className="form-grid">
          <label className="field">
            Titulo ML
            <input maxLength={60} value={values.titulo_ml} onChange={(event) => setField('titulo_ml', event.target.value)} />
          </label>
          <label className="field">
            Titulo Shopee
            <input
              maxLength={120}
              value={values.titulo_shopee}
              onChange={(event) => setField('titulo_shopee', event.target.value)}
            />
          </label>
          <label className="field field-full">
            Descricao
            <textarea rows={7} value={values.descricao} onChange={(event) => setField('descricao', event.target.value)} />
          </label>
          <label className="field">
            Categoria ML
            <input value={values.categoria_ml_id} onChange={(event) => setField('categoria_ml_id', event.target.value)} />
          </label>
          <label className="field">
            Categoria Shopee ID
            <input
              type="number"
              value={values.categoria_shopee_id}
              onChange={(event) => setField('categoria_shopee_id', event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="actions-row">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          <Save />
          {submitting ? 'Salvando...' : 'Salvar alteracoes'}
        </button>
        <PublishProdutoButtons produtoId={produto.id} />
      </div>
    </form>
  )
}
