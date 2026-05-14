'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Bot, Save, Send } from 'lucide-react'

type ClienteOption = {
  id: string
  nome: string
}

type AiResponse = {
  titulo_ml: string
  titulo_shopee: string
  descricao: string
  categoria_ml_sugerida: string
  categoria_shopee_id: number
  atributos: Record<string, unknown>
}

export default function NovoProdutoPage() {
  const router = useRouter()
  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [clienteId, setClienteId] = useState('')
  const [nomeProduto, setNomeProduto] = useState('')
  const [fotoUrl, setFotoUrl] = useState('')
  const [preco, setPreco] = useState('')
  const [quantidade, setQuantidade] = useState('1')
  const [condicao, setCondicao] = useState<'new' | 'used' | 'not_specified'>('new')
  const [tituloMl, setTituloMl] = useState('')
  const [tituloShopee, setTituloShopee] = useState('')
  const [descricao, setDescricao] = useState('')
  const [categoriaMl, setCategoriaMl] = useState('')
  const [categoriaShopeeId, setCategoriaShopeeId] = useState('0')
  const [atributos, setAtributos] = useState<Record<string, unknown>>({})
  const [loadingClientes, setLoadingClientes] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [submitting, setSubmitting] = useState('')
  const [error, setError] = useState('')

  const canGenerate = useMemo(() => Boolean(clienteId && nomeProduto.trim()), [clienteId, nomeProduto])

  useEffect(() => {
    async function loadClientes() {
      const response = await fetch('/api/clientes')
      const data = (await response.json()) as ClienteOption[]
      setClientes(data)
      setLoadingClientes(false)
    }

    loadClientes().catch(() => {
      setError('Nao foi possivel carregar os clientes.')
      setLoadingClientes(false)
    })
  }, [])

  async function gerarCopy() {
    if (!canGenerate) return
    setError('')
    setGenerating(true)

    const response = await fetch('/api/ai/gerar-copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: clienteId, nome_produto: nomeProduto }),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? 'Nao foi possivel gerar a copy.')
      setGenerating(false)
      return
    }

    const data = (await response.json()) as AiResponse
    setTituloMl(data.titulo_ml)
    setTituloShopee(data.titulo_shopee)
    setDescricao(data.descricao)
    setCategoriaMl(data.categoria_ml_sugerida)
    setCategoriaShopeeId(String(data.categoria_shopee_id))
    setAtributos(data.atributos)
    setGenerating(false)
  }

  async function salvar(publicarMl = false, publicarShopee = false) {
    setError('')
    setSubmitting(publicarMl && publicarShopee ? 'ambos' : publicarMl ? 'ml' : publicarShopee ? 'shopee' : 'rascunho')

    const response = await fetch('/api/produtos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cliente_id: clienteId,
        nome_original: nomeProduto,
        foto_url: fotoUrl,
        preco,
        quantidade,
        condicao,
        status: publicarMl || publicarShopee ? 'pendente' : 'rascunho',
        titulo_ml: tituloMl,
        titulo_shopee: tituloShopee,
        descricao,
        categoria_ml_id: categoriaMl,
        categoria_shopee_id: categoriaShopeeId,
        atributos,
        publicar_ml: publicarMl,
        publicar_shopee: publicarShopee,
      }),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? 'Nao foi possivel salvar o produto.')
      setSubmitting('')
      return
    }

    router.push(publicarMl || publicarShopee ? '/publicacoes' : '/produtos')
    router.refresh()
  }

  async function uploadFoto(file: File | undefined) {
    if (!file) {
      setFotoUrl('')
      return
    }

    setError('')
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/upload', { method: 'POST', body: formData })

    if (!response.ok) {
      setError('Nao foi possivel enviar a imagem.')
      setUploading(false)
      return
    }

    const data = (await response.json()) as { url: string }
    setFotoUrl(data.url)
    setUploading(false)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    salvar(false, false)
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Catalogo inteligente</p>
          <h1>Novo Produto</h1>
          <p className="page-subtitle">Crie o rascunho, gere copy por IA e prepare a publicacao por marketplace.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="form-stack">
        {error ? (
          <div className="error-box">
            {error}
          </div>
        ) : null}

        <div className="panel form-panel">
          <div className="form-grid">
          <label className="field">
            Cliente
            <select
              required
              value={clienteId}
              onChange={(event) => setClienteId(event.target.value)}
            >
              <option value="">{loadingClientes ? 'Carregando...' : 'Selecione um cliente'}</option>
              {clientes.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {cliente.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Nome do produto
            <input
              required
              value={nomeProduto}
              onChange={(event) => setNomeProduto(event.target.value)}
            />
          </label>

          <label className="field">
            Foto
            <input
              type="file"
              accept="image/*"
              onChange={(event) => uploadFoto(event.target.files?.[0])}
            />
            <span className="counter">{uploading ? 'Enviando imagem...' : fotoUrl || 'Opcional'}</span>
          </label>

          <div className="form-grid-3">
            <label className="field">
              Preco
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={preco}
                onChange={(event) => setPreco(event.target.value)}
              />
            </label>

            <label className="field">
              Qtd.
              <input
                required
                type="number"
                min="1"
                value={quantidade}
                onChange={(event) => setQuantidade(event.target.value)}
              />
            </label>

            <label className="field">
              Condicao
              <select
                value={condicao}
                onChange={(event) => setCondicao(event.target.value as 'new' | 'used' | 'not_specified')}
              >
                <option value="new">new</option>
                <option value="used">used</option>
                <option value="not_specified">not_specified</option>
              </select>
            </label>
          </div>
          </div>
        </div>

        <div className="panel form-panel">
          <button
            type="button"
            disabled={!canGenerate || generating}
            onClick={gerarCopy}
            className="btn btn-dark"
          >
            <Bot />
            {generating ? 'Gerando...' : 'Gerar com IA'}
          </button>
        </div>

        <div className="panel form-panel">
          <div className="form-grid">
          <label className="field">
            Titulo ML
            <input
              maxLength={60}
              value={tituloMl}
              onChange={(event) => setTituloMl(event.target.value)}
            />
            <span className="counter">{tituloMl.length}/60</span>
          </label>

          <label className="field">
            Titulo Shopee
            <input
              maxLength={120}
              value={tituloShopee}
              onChange={(event) => setTituloShopee(event.target.value)}
            />
            <span className="counter">{tituloShopee.length}/120</span>
          </label>

          <label className="field field-full">
            Descricao
            <textarea
              rows={7}
              value={descricao}
              onChange={(event) => setDescricao(event.target.value)}
            />
          </label>

          <label className="field">
            Categoria ML
            <input
              value={categoriaMl}
              onChange={(event) => setCategoriaMl(event.target.value)}
            />
          </label>

          <label className="field">
            Categoria Shopee ID
            <input
              type="number"
              value={categoriaShopeeId}
              onChange={(event) => setCategoriaShopeeId(event.target.value)}
            />
          </label>
          </div>
        </div>

        <div className="actions-row">
          <button
            type="submit"
            disabled={Boolean(submitting)}
            className="btn btn-secondary"
          >
            <Save />
            {submitting === 'rascunho' ? 'Salvando...' : 'Salvar Rascunho'}
          </button>

          <button
            type="button"
            disabled={Boolean(submitting)}
            onClick={() => salvar(true, false)}
            className="btn btn-ml"
          >
            <Send />
            {submitting === 'ml' ? 'Salvando...' : 'Publicar no ML'}
          </button>

          <button
            type="button"
            disabled={Boolean(submitting)}
            onClick={() => salvar(false, true)}
            className="btn btn-shopee"
          >
            <Send />
            {submitting === 'shopee' ? 'Salvando...' : 'Publicar na Shopee'}
          </button>

          <button
            type="button"
            disabled={Boolean(submitting)}
            onClick={() => salvar(true, true)}
            className="btn btn-primary"
          >
            <Send />
            {submitting === 'ambos' ? 'Salvando...' : 'Publicar em Ambos'}
          </button>
        </div>
      </form>
    </section>
  )
}
