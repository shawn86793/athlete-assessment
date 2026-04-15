import type { Config } from '@netlify/functions'
import { jsonResponse, listAuditLogsRange, loadUserSummary, requireSuperAdminOr401 } from './_admin.mts'

const toMs = (value: string, fallback: number) => {
  const parsed = Date.parse(String(value || '').trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

export default async (req: Request) => {
  const auth = requireSuperAdminOr401(req)
  if (auth instanceof Response) return auth

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const url = new URL(req.url)
  const now = Date.now()
  const fromMs = toMs(String(url.searchParams.get('from') || ''), now - 7 * 24 * 60 * 60 * 1000)
  const toMsValue = toMs(String(url.searchParams.get('to') || ''), now)
  const actionFilter = String(url.searchParams.get('action') || '').trim().toLowerCase()
  const targetFilter = String(url.searchParams.get('target') || '').trim().toLowerCase()

  const rows = await listAuditLogsRange(fromMs, toMsValue)
  const userIds = new Set<string>()
  for (const row of rows) {
    const possibleIds = [row.userId, row.target]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .filter(value => !value.includes('@'))
    for (const value of possibleIds) userIds.add(value)
  }

  const userEmailMap = new Map<string, string>()
  await Promise.all(
    Array.from(userIds).map(async userId => {
      try {
        const summary = await loadUserSummary(userId)
        const email = String(summary?.email || '').trim().toLowerCase()
        if (email) userEmailMap.set(userId, email)
      } catch {
        // best effort
      }
    })
  )

  const enriched = rows.map((row) => {
    const userId = String(row.userId || '').trim()
    const target = String(row.target || '').trim()
    const byUserId = userId && !userId.includes('@') ? userEmailMap.get(userId) || '' : ''
    const byTarget = target && !target.includes('@') ? userEmailMap.get(target) || '' : ''
    const existingEmail = String(row.email || row.adminEmail || '').trim().toLowerCase()
    const loginEmail = existingEmail || byUserId || byTarget
    return {
      ...row,
      loginEmail: loginEmail || null,
    }
  })

  const filtered = enriched
    .filter((row) => {
      const action = String(row.action || '').toLowerCase()
      if (actionFilter && action !== actionFilter) return false
      if (!targetFilter) return true
      const target = String(
        row.loginEmail || row.email || row.adminEmail || row.target || row.userId || row.customerId || ''
      ).toLowerCase()
      return target.includes(targetFilter) || String(row.userId || '').toLowerCase().includes(targetFilter)
    })
    .sort((a, b) => Date.parse(String(b.timestamp || '')) - Date.parse(String(a.timestamp || '')))

  return jsonResponse({
    count: filtered.length,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMsValue).toISOString(),
    logs: filtered,
  })
}

export const config: Config = {
  path: '/api/admin/audit',
  method: 'GET',
}
