import type { Config } from '@netlify/functions'
import { getEnv, jsonResponse, loadAllUserIds, loadUserSummary, requireSuperAdminOr401 } from './_admin.mts'

const PAGE_SIZE_DEFAULT = 25
const PAGE_SIZE_MAX = 100

type IdentityUser = {
  id: string
  email: string
}

const getSiteBaseUrl = () => {
  const raw =
    getEnv('URL') ||
    getEnv('DEPLOY_PRIME_URL') ||
    getEnv('DEPLOY_URL') ||
    getEnv('SITE_URL')
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, '') : `https://${raw.replace(/\/+$/, '')}`
}

const loadIdentityUsers = async () => {
  const identityJwt = getEnv('NETLIFY_IDENTITY_JWT')
  const baseUrl = getSiteBaseUrl()
  if (!identityJwt || !baseUrl) return [] as IdentityUser[]
  try {
    const res = await fetch(`${baseUrl}/.netlify/identity/admin/users`, {
      headers: { Authorization: `Bearer ${identityJwt}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return [] as IdentityUser[]
    const payload = (await res.json().catch(() => [])) as unknown
    const rows = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray((payload as { users?: unknown[] }).users)
        ? (payload as { users: unknown[] }).users
        : []
    return rows
      .map((entry) => {
        const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
        return {
          id: String(row.id || row.user_id || '').trim(),
          email: String(row.email || '').trim().toLowerCase(),
        }
      })
      .filter((row) => row.id)
  } catch {
    return [] as IdentityUser[]
  }
}

export default async (req: Request) => {
  const auth = requireSuperAdminOr401(req)
  if (auth instanceof Response) return auth

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const url = new URL(req.url)
  const query = String(url.searchParams.get('q') || '').trim().toLowerCase()
  const plan = String(url.searchParams.get('plan') || '').trim().toLowerCase()
  const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1)
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(url.searchParams.get('pageSize') || PAGE_SIZE_DEFAULT) || PAGE_SIZE_DEFAULT)
  )

  const userRows = await loadAllUserIds()
  const users = await Promise.all(userRows.map(row => loadUserSummary(row.userId, row.identityEmail)))
  const identityUsers = await loadIdentityUsers()
  const identityById = new Map<string, string>()
  for (const user of identityUsers) {
    if (user.id) identityById.set(user.id, String(user.email || '').trim().toLowerCase())
  }

  const usersWithIdentityEmail = users.map((user) => {
    const currentEmail = String(user.email || '').trim().toLowerCase()
    if (currentEmail.includes('@')) return user
    const identityEmail = identityById.get(String(user.userId || '').trim()) || ''
    if (!identityEmail) return user
    return {
      ...user,
      email: identityEmail,
    }
  })

  const filtered = query
    ? usersWithIdentityEmail.filter(user => {
        const email = String(user.email || '').toLowerCase()
        const name = String(user.displayName || '').toLowerCase()
        return email.includes(query) || name.includes(query)
      })
    : usersWithIdentityEmail

  const planFiltered = plan ? filtered.filter(user => String(user.planTier || 'free').toLowerCase() === plan) : filtered

  planFiltered.sort((a, b) => {
    const aTime = a.lastActiveDate ? Date.parse(a.lastActiveDate) : 0
    const bTime = b.lastActiveDate ? Date.parse(b.lastActiveDate) : 0
    return bTime - aTime
  })

  const start = (page - 1) * pageSize
  const rows = planFiltered.slice(start, start + pageSize)

  return jsonResponse({
    users: rows,
    page,
    pageSize,
    total: planFiltered.length,
    totalPages: Math.max(1, Math.ceil(planFiltered.length / pageSize)),
    planFilter: plan || null,
  })
}

export const config: Config = {
  path: '/api/admin/users',
  method: 'GET',
}
