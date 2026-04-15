import type { Config } from '@netlify/functions'
import {
  jsonRes,
  loadEnterpriseAuditRange,
  requireEnterpriseAdmin,
} from './_enterprise.mts'

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'GET') return jsonRes({ error: 'Method not allowed.' }, 405)

  const auth = await requireEnterpriseAdmin(req, 'owner')
  if (auth instanceof Response) return auth
  const { orgSlug } = auth

  const url = new URL(req.url)
  const now = Date.now()
  const fromMs = Date.parse(String(url.searchParams.get('from') || '')) || now - 7 * 86400000
  const toMs = Date.parse(String(url.searchParams.get('to') || '')) || now
  const actionFilter = String(url.searchParams.get('action') || '').trim().toLowerCase()
  const adminFilter = String(url.searchParams.get('admin') || '').trim().toLowerCase()
  const limit = Math.min(500, Math.max(10, Number(url.searchParams.get('limit') || 200)))

  let entries = await loadEnterpriseAuditRange(orgSlug, fromMs, toMs)

  if (actionFilter) entries = entries.filter(e => String(e.action || '').toLowerCase().includes(actionFilter))
  if (adminFilter) entries = entries.filter(e => String(e.email || '').toLowerCase().includes(adminFilter))

  return jsonRes({
    count: entries.length,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    logs: entries.slice(0, limit),
  })
}

export const config: Config = {
  path: '/api/enterprise/audit',
  method: ['GET', 'OPTIONS'],
}
