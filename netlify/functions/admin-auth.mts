import type { Config, Context } from '@netlify/functions'
import { createLogger } from './_logger.mts'
import { getAdminAccess, getAdminAllowlist, issueAdminToken, jsonResponse, readJsonBody, writeAuditLog } from './_admin.mts'

const log = createLogger('admin-auth')

const getIdentityToken = (req: Request) => {
  const header = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!header) return ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ? match[1] : ''
}

const getIdentityEmailFromToken = (req: Request) => {
  const token = getIdentityToken(req)
  if (!token) return ''
  const parts = token.split('.')
  if (parts.length !== 3) return ''
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'))
    return String(payload?.email || '').trim().toLowerCase()
  } catch {
    return ''
  }
}

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const body = await readJsonBody(req)
  const mode = String(body?.mode || '').trim().toLowerCase()
  const identityToken = getIdentityToken(req)
  const identityEmail = getIdentityEmailFromToken(req)

  const adminEmails = getAdminAllowlist()

  if (!adminEmails.size) {
    return jsonResponse({ error: 'Admin auth is not configured.' }, { status: 503 })
  }
  const access = getAdminAccess(identityEmail)

  if (mode === 'status') {
    return jsonResponse({ ok: true, isAdmin: access.isAdmin, isSuperAdmin: access.isSuperAdmin })
  }

  if (mode === 'identity') {
    if (!identityEmail || !access.isSuperAdmin) {
      await writeAuditLog({
        action: 'admin_auth_identity_failed',
        target: identityEmail || 'unknown',
        status: 'failed',
      })
      return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })
    }
    const token = issueAdminToken(identityToken)
    if (!token) {
      return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })
    }
    await writeAuditLog({
      action: 'admin_auth_identity_success',
      target: identityEmail,
      status: 'ok',
    })
    return jsonResponse({
      token,
      expiresInSeconds: 2 * 60 * 60,
      adminEmail: identityEmail,
      isAdmin: access.isAdmin,
      isSuperAdmin: access.isSuperAdmin,
    })
  }
  return jsonResponse({ error: 'Unsupported auth mode.' }, { status: 400 })
}

export const config: Config = {
  path: '/api/admin/auth',
  method: 'POST',
}
