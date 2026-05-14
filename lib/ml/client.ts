const ML_API_BASE = 'https://api.mercadolibre.com'
const ML_AUTH_BASE = 'https://auth.mercadolivre.com.br/authorization'

type MlTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  user_id: number | string
}

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} nao configurado.`)
  return value
}

export function getAuthUrl() {
  const url = new URL(ML_AUTH_BASE)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', requireEnv('ML_APP_ID'))
  url.searchParams.set('redirect_uri', requireEnv('ML_REDIRECT_URI'))
  return url.toString()
}

export async function exchangeCode(code: string): Promise<MlTokenResponse> {
  const response = await fetch(`${ML_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: requireEnv('ML_APP_ID'),
      client_secret: requireEnv('ML_SECRET'),
      code,
      redirect_uri: requireEnv('ML_REDIRECT_URI'),
    }),
  })

  if (!response.ok) {
    throw new Error(`Falha ao trocar code ML: ${await response.text()}`)
  }

  return response.json()
}

export async function refreshToken(refreshTokenValue: string): Promise<MlTokenResponse> {
  const response = await fetch(`${ML_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: requireEnv('ML_APP_ID'),
      client_secret: requireEnv('ML_SECRET'),
      refresh_token: refreshTokenValue,
    }),
  })

  if (!response.ok) {
    throw new Error(`Falha ao renovar token ML: ${await response.text()}`)
  }

  return response.json()
}

export async function getMe(accessToken: string) {
  const response = await fetch(`${ML_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Falha ao buscar usuario ML: ${await response.text()}`)
  }

  return response.json() as Promise<{ id: number | string }>
}
