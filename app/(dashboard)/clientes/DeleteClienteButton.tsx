'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Trash2 } from 'lucide-react'

export function DeleteClienteButton({ id }: { id: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    if (!confirm('Excluir este cliente e todos os dados vinculados?')) return

    setLoading(true)
    await fetch(`/api/clientes/${id}`, { method: 'DELETE' })
    router.refresh()
    setLoading(false)
  }

  return (
    <button onClick={handleDelete} disabled={loading} className="btn btn-danger">
      <Trash2 />
      {loading ? 'Excluindo...' : 'Excluir'}
    </button>
  )
}
