import crypto from 'crypto'

type ShopeeTokenResponse = {
  access_token: string
  refresh_token: string
  expire_in: number
  shop_id?: number
}

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} nao configurado.`)
  return value
}

export function getShopeeHost() {
  return process.env.SHOPEE_SANDBOX === 'true'
    ? requireEnv('SHOPEE_SANDBOX_HOST')
    : requireEnv('SHOPEE_HOST')
}

export function sign(path: string, timestamp: number, accessToken?: string, shopId?: number) {
  const partnerId = requireEnv('SHOPEE_PARTNER_ID')
  const partnerKey = requireEnv('SHOPEE_PARTNER_KEY')
  const base = `${partnerId}${path}${timestamp}${accessToken ?? ''}${shopId ?? ''}`
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
}

export function getAuthUrl() {
  const host = getShopeeHost()
  const path = '/api/v2/shop/auth_partner'
  const timestamp = nowTimestamp()
  const partnerId = requireEnv('SHOPEE_PARTNER_ID')
  const redirect = requireEnv('SHOPEE_REDIRECT_URI')
  const url = new URL(`${host}${path}`)
  url.searchParams.set('partner_id', partnerId)
  url.searchParams.set('timestamp', String(timestamp))
  url.searchParams.set('sign', sign(path, timestamp))
  url.searchParams.set('redirect', redirect)
  return url.toString()
}

export function nowTimestamp() {
  return Math.floor(Date.now() / 1000)
}

async function shopeeTokenRequest(path: string, body: Record<string, unknown>): Promise<ShopeeTokenResponse> {
  const host = getShopeeHost()
  const timestamp = nowTimestamp()
  const partnerId = Number(requireEnv('SHOPEE_PARTNER_ID'))
  const url = new URL(`${host}${path}`)
  url.searchParams.set('partner_id', String(partnerId))
  url.searchParams.set('timestamp', String(timestamp))
  url.searchParams.set('sign', sign(path, timestamp))

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partner_id: partnerId, ...body }),
  })

  if (!response.ok) {
    throw new Error(`Falha Shopee OAuth: ${await response.text()}`)
  }

  const data = await response.json()
  if (data.error) throw new Error(`Falha Shopee OAuth: ${JSON.stringify(data)}`)
  return data
}

export async function exchangeCode(code: string, shopId: number) {
  return shopeeTokenRequest('/api/v2/auth/token/get', { code, shop_id: shopId })
}

export async function refreshToken(refreshTokenValue: string, shopId: number) {
  return shopeeTokenRequest('/api/v2/auth/access_token/get', {
    refresh_token: refreshTokenValue,
    shop_id: shopId,
  })
}
