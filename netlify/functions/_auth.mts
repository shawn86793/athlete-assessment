import type { Context } from '@netlify/functions'

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf-8')
}

const getTokenPayload = (token: string) => {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    return JSON.parse(base64UrlDecode(parts[1]))
  } catch {
    return null
  }
}

const getBearerToken = (req: Request) => {
  const header = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

export const getUserId = (req: Request, context: Context) => {
  const clientContext = (context as unknown as { clientContext?: { user?: Record<string, string> } })
    .clientContext
  const clientUser = clientContext?.user
  const clientEmail = String(clientUser?.email || "").trim().toLowerCase()
  if (clientEmail && clientEmail.includes("@")) return clientEmail

  const clientId = String(clientUser?.id || clientUser?.sub || "").trim().toLowerCase()
  if (clientId && clientId.includes("@")) return clientId

  const token = getBearerToken(req)
  if (!token) return null
  const payload = getTokenPayload(token)
  if (!payload) return null
  const email = String(payload?.email || "").trim().toLowerCase()
  if (email && email.includes("@")) return email

  const fallbackId = String(payload?.user_id || payload?.sub || "").trim().toLowerCase()
  return fallbackId && fallbackId.includes("@") ? fallbackId : null
}
