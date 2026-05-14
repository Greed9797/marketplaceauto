const ML_API_BASE = 'https://api.mercadolibre.com'

async function mlFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ML_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return response.json()
}

export async function uploadImagem(token: string, imagePath: string) {
  return mlFetch<{ id: string }>(token, '/pictures/items/upload', {
    method: 'POST',
    body: JSON.stringify({ source: imagePath }),
  })
}

export async function buscarCategoria(token: string, titulo: string) {
  const params = new URLSearchParams({ q: titulo })
  const rows = await mlFetch<Array<{ category_id: string }>>(
    token,
    `/sites/MLB/domain_discovery/search?${params.toString()}`,
  )
  return rows[0]?.category_id
}

export async function buscarAtributos(token: string, categoryId: string) {
  return mlFetch<Array<{ id: string; name: string; required?: boolean }>>(token, `/categories/${categoryId}/attributes`)
}

export async function criarItem(token: string, payload: Record<string, unknown>) {
  return mlFetch<{ id: string; permalink?: string }>(token, '/items', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function adicionarDescricao(token: string, itemId: string, texto: string) {
  return mlFetch(token, `/items/${itemId}/description`, {
    method: 'POST',
    body: JSON.stringify({ plain_text: texto }),
  })
}

export async function pausarItem(token: string, itemId: string) {
  return mlFetch(token, `/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ status: 'paused' }) })
}

export async function ativarItem(token: string, itemId: string) {
  return mlFetch(token, `/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ status: 'active' }) })
}
