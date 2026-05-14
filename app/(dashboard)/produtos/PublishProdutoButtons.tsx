'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Send } from 'lucide-react'

export function PublishProdutoButtons({ produtoId }: { produtoId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState('')

  async function publish(platform: 'ml' | 'shopee') {
    setLoading(platform)
    await fetch(`/api/${platform}/publicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produto_id: produtoId }),
    })
    router.refresh()
    setLoading('')
  }

  return (
    <>
      <button type="button" className="btn btn-ml" disabled={Boolean(loading)} onClick={() => publish('ml')}>
        <Send />
        {loading === 'ml' ? 'Publicando...' : 'ML'}
      </button>
      <button type="button" className="btn btn-shopee" disabled={Boolean(loading)} onClick={() => publish('shopee')}>
        <Send />
        {loading === 'shopee' ? 'Publicando...' : 'Shopee'}
      </button>
    </>
  )
}
