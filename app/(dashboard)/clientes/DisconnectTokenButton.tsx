'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Unlink } from 'lucide-react'

export function DisconnectTokenButton({
  clienteId,
  plataforma,
}: {
  clienteId: string
  plataforma: 'ml' | 'shopee'
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDisconnect() {
    setLoading(true)
    await fetch(`/api/auth/${plataforma}/disconnect?cliente_id=${clienteId}`, { method: 'DELETE' })
    router.refresh()
    setLoading(false)
  }

  return (
    <button type="button" className="btn btn-secondary" disabled={loading} onClick={handleDisconnect}>
      <Unlink />
      {loading ? 'Desconectando...' : 'Desconectar'}
    </button>
  )
}
