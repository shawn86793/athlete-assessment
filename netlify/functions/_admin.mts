import type { Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { ensureSchema, getSqlClient } from './_neon.mts'

export type AdminClaims = Record<string, unknown> & {
  email: string
}

export const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) => Response.json(body, init)

export const readJsonBody = async (req: Request) => {
  const raw = await req.text().catch(() => '')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const base64urlDecode = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf-8')
}

const getBearerToken = (req: Request) => {
  const header = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

const isValidString = (value: unknown) => typeof value === 'string' && value.trim().length > 0

export const getEnv = (key: string) => {
  const value = Netlify.env.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

export const seasonStore = getStore({ name: 'seasons', consistency: 'strong' })
export const adminStore = getStore({ name: 'admin-dashboard', consistency: 'strong' })
export const cloudStore = getStore({ name: 'cloud-tryouts', consistency: 'strong' })

export const issueAdminToken = (identityJwt: string) => (isValidString(identityJwt) ? identityJwt : null)

const parseEmailAllowlist = (...keys: string[]) => {
  const emails = new Set<string>()
  const add = (value: unknown) => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
    if (normalized) emails.add(normalized)
  }
  for (const key of keys) {
    const raw = getEnv(key)
    if (!raw) continue
    if (key.endsWith('_EMAILS')) {
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach(add)
      continue
    }
    add(raw)
  }
  return emails
}

const SUPER_ADMIN_SEED_EMAILS = new Set(['shawngilbert047@gmail.com'])

const withSeedEmails = (allowlist: Set<string>, seed: Set<string>) => {
  for (const email of seed) {
    const normalized = String(email || '')
      .trim()
      .toLowerCase()
    if (normalized) allowlist.add(normalized)
  }
  return allowlist
}

export const getAdminAllowlist = () =>
  withSeedEmails(parseEmailAllowlist('ADMIN_EMAILS', 'ADMIN_EMAIL'), SUPER_ADMIN_SEED_EMAILS)

export const getSuperAdminAllowlist = () =>
  withSeedEmails(parseEmailAllowlist('SUPER_ADMIN_EMAILS', 'SUPER_ADMIN_EMAIL'), SUPER_ADMIN_SEED_EMAILS)

export const getAdminAccess = (email: string) => {
  const normalized = String(email || '')
    .trim()
    .toLowerCase()
  if (!normalized) return { isAdmin: false, isSuperAdmin: false }
  const adminAllowlist = getAdminAllowlist()
  const superAdminAllowlist = getSuperAdminAllowlist()
  const isAdmin = adminAllowlist.has(normalized)
  const isSuperAdmin = superAdminAllowlist.size ? superAdminAllowlist.has(normalized) : isAdmin
  return { isAdmin, isSuperAdmin }
}

const getTokenClaims = (req: Request) => {
  const token = getBearerToken(req)
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    return JSON.parse(base64urlDecode(parts[1])) as Record<string, unknown>
  } catch {
    return null
  }
}

export const requireAdminOr401 = (req: Request) => {
  const claims = getTokenClaims(req)
  if (!claims) return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })

  const email = String(claims?.email || '')
    .trim()
    .toLowerCase()
  const access = getAdminAccess(email)
  if (!access.isAdmin) return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })
  return { ...claims, email } as AdminClaims
}

export const requireSuperAdminOr401 = (req: Request) => {
  const claims = getTokenClaims(req)
  if (!claims) return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })
  const email = String(claims?.email || '')
    .trim()
    .toLowerCase()
  const access = getAdminAccess(email)
  if (!access.isSuperAdmin) return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })
  return { ...claims, email } as AdminClaims
}

const toDateLikeMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const toIso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null)

const normalizeProfile = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, unknown>
  return value as Record<string, unknown>
}

const normalizePlanTier = (value: unknown) => {
  const tier = String(value || 'free').trim().toLowerCase()
  const valid = new Set(['free', 'starter', 'club', 'pro', 'organization'])
  return valid.has(tier) ? tier : 'free'
}

const getProfileDisplayName = (profile: Record<string, unknown>) =>
  String(profile.displayName || profile.fullName || profile.name || '').trim()

const getProfileEmail = (profile: Record<string, unknown>) =>
  String(profile.email || profile.userEmail || '').trim().toLowerCase()

const toEmail = (value: unknown) => String(value || '').trim().toLowerCase()
const isEmailLike = (value: unknown) => toEmail(value).includes('@')
const resolveLoginEmail = (...values: unknown[]) => {
  for (const value of values) {
    const normalized = toEmail(value)
    if (normalized && isEmailLike(normalized)) return normalized
  }
  return ''
}

const getEmailFromUserId = (userId: string) => {
  const normalized = String(userId || '').trim().toLowerCase()
  return normalized.includes('@') ? normalized : ''
}

const getEmailFromSeasons = (blobSeasons: Record<string, Record<string, unknown>>) => {
  for (const season of Object.values(blobSeasons || {})) {
    if (!season || typeof season !== 'object' || Array.isArray(season)) continue
    const record = season as Record<string, unknown>
    const headAssessorEmail = String(record.headAssessorEmail || '').trim().toLowerCase()
    if (headAssessorEmail) return headAssessorEmail
    const coachEmail = String(record.coachEmail || '').trim().toLowerCase()
    if (coachEmail) return coachEmail
  }
  return ''
}

const loadProfile = async (userId: string) => normalizeProfile(await seasonStore.get(`users/${userId}/profile`, { type: 'json' }))

const loadBlobSeasons = async (userId: string) => {
  const data = await seasonStore.get(`users/${userId}/seasons`, { type: 'json' })
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  return data as Record<string, Record<string, unknown>>
}

export type BlobPage = { keys: string[]; nextCursor: string | null }

/**
 * List blob keys under a prefix with optional cursor-based pagination.
 * @param maxPages  Hard cap on API pages fetched (default 40, each page is 100 items).
 * @param afterCursor  Resume from a previously returned nextCursor.
 */
const listBlobKeys = async (
  prefix: string,
  { maxPages = 40, afterCursor }: { maxPages?: number; afterCursor?: string } = {},
): Promise<string[]> => {
  const { keys } = await listBlobKeysPaged(prefix, { maxPages, afterCursor })
  return keys
}

export const listBlobKeysPaged = async (
  prefix: string,
  { maxPages = 40, afterCursor, pageLimit = 100 }: { maxPages?: number; afterCursor?: string; pageLimit?: number } = {},
): Promise<BlobPage> => {
  const keys: string[] = []
  let cursor: string | undefined = afterCursor
  for (let i = 0; i < maxPages; i += 1) {
    const page = (await seasonStore.list({ prefix, cursor, limit: pageLimit })) as {
      blobs?: Array<{ key?: string }>
      cursor?: string
      hasMore?: boolean
      directories?: Array<{ prefix?: string }>
    }
    for (const blob of page.blobs || []) {
      if (blob?.key) keys.push(blob.key)
    }
    for (const dir of page.directories || []) {
      const value = String(dir?.prefix || '')
      if (value) keys.push(value)
    }
    if (!page.hasMore || !page.cursor) return { keys, nextCursor: null }
    cursor = page.cursor
  }
  return { keys, nextCursor: cursor ?? null }
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
  if (!identityJwt || !baseUrl) return [] as Array<{ userId: string; email: string }>

  const endpoint = `${baseUrl}/.netlify/identity/admin/users`
  try {
    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${identityJwt}`,
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return [] as Array<{ userId: string; email: string }>
    const payload = (await res.json().catch(() => [])) as unknown
    const rows = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray((payload as { users?: unknown[] }).users)
        ? (payload as { users: unknown[] }).users
        : []
    return rows
      .map((row) => {
        const item = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
        const userId = String(item.id || item.user_id || '').trim()
        const email = String(item.email || '').trim().toLowerCase()
        return { userId, email }
      })
      .filter((row) => row.userId)
  } catch {
    return [] as Array<{ userId: string; email: string }>
  }
}

export type UserIdentitySummary = {
  userId: string
  identityEmail: string
}

const getSqlStatsByUser = async (userId: string) => {
  const sql = getSqlClient()
  if (!sql) {
    return {
      teamCount: 0,
      assessmentCount: 0,
      lastUpdatedMs: null as number | null,
      minCreatedMs: null as number | null,
      tryouts: [] as Array<Record<string, unknown>>,
      teams: [] as Array<Record<string, unknown>>,
      seasons: [] as Array<Record<string, unknown>>,
    }
  }

  await ensureSchema(sql)

  const tryoutsRows = await sql<{ payload: unknown; updated_at: string }[]>`
    select payload, updated_at
    from tryouts
    where user_id = ${userId}
  `
  const teamsRows = await sql<{ payload: unknown; updated_at: string }[]>`
    select payload, updated_at
    from teams
    where user_id = ${userId}
  `
  const seasonsRows = await sql<{ payload: unknown; updated_at: string }[]>`
    select payload, updated_at
    from seasons
    where user_id = ${userId}
  `

  let lastUpdatedMs: number | null = null
  let minCreatedMs: number | null = null

  const collectTimes = (payload: unknown, updatedAt: string) => {
    const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const created = toDateLikeMs(obj.createdAt)
    const updated = toDateLikeMs(obj.updatedAt) || toDateLikeMs(updatedAt)
    if (updated && (!lastUpdatedMs || updated > lastUpdatedMs)) lastUpdatedMs = updated
    if (created && (!minCreatedMs || created < minCreatedMs)) minCreatedMs = created
  }

  for (const row of tryoutsRows) collectTimes(row.payload, row.updated_at)
  for (const row of teamsRows) collectTimes(row.payload, row.updated_at)
  for (const row of seasonsRows) collectTimes(row.payload, row.updated_at)

  return {
    teamCount: teamsRows.length,
    assessmentCount: tryoutsRows.length,
    lastUpdatedMs,
    minCreatedMs,
    tryouts: tryoutsRows.map(row => (row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {})),
    teams: teamsRows.map(row => (row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {})),
    seasons: seasonsRows.map(row => (row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {})),
  }
}

export const loadAllUserIds = async () => {
  const usersById = new Map<string, string>()
  const upsert = (userIdRaw: string, identityEmailRaw = '') => {
    const userId = String(userIdRaw || '').trim()
    if (!userId) return
    const identityEmail = String(identityEmailRaw || '').trim().toLowerCase()
    const existing = usersById.get(userId) || ''
    usersById.set(userId, existing || identityEmail)
  }

  const sql = getSqlClient()
  if (sql) {
    await ensureSchema(sql)
    const sqlUsers = await sql<{ user_id: string }[]>`
      select distinct user_id from (
        select user_id from tryouts
        union
        select user_id from teams
        union
        select user_id from seasons
      ) as users
    `
    for (const row of sqlUsers) {
      if (row?.user_id) upsert(String(row.user_id))
    }
  }

  const keys = await listBlobKeys('users/')
  for (const key of keys) {
    const match = String(key).match(/^users\/([^/]+)\//)
    if (match?.[1]) upsert(match[1])
  }

  const identityUsers = await loadIdentityUsers()
  for (const user of identityUsers) {
    upsert(user.userId, user.email)
  }

  return Array.from(usersById.entries()).map(([userId, identityEmail]) => ({ userId, identityEmail }))
}

export const loadUserSummary = async (userId: string, identityEmailOverride = '') => {
  const profile = await loadProfile(userId)
  const blobSeasons = await loadBlobSeasons(userId)
  const sqlStats = await getSqlStatsByUser(userId)
  const identityEmail = String(identityEmailOverride || '').trim().toLowerCase()
  const loginEmail = resolveLoginEmail(
    getProfileEmail(profile),
    identityEmail,
    getEmailFromUserId(userId),
    getEmailFromSeasons(blobSeasons)
  )

  const lastActiveCandidates = [
    toDateLikeMs(profile.lastActiveAt),
    sqlStats.lastUpdatedMs,
  ].filter(Boolean) as number[]

  const createdCandidates = [
    toDateLikeMs(profile.createdAt),
    sqlStats.minCreatedMs,
  ].filter(Boolean) as number[]

  const lastActiveMs = lastActiveCandidates.length ? Math.max(...lastActiveCandidates) : null
  const createdAtMs = createdCandidates.length ? Math.min(...createdCandidates) : null

  const planTier = normalizePlanTier(profile.planTier || profile.plan || profile.subscriptionTier)
  const teamCount = Math.max(sqlStats.teamCount, Number(profile.teamCount || 0) || 0)
  const assessmentCount = Math.max(sqlStats.assessmentCount, Number(profile.assessmentCount || 0) || 0)
  const playerCount = sqlStats.tryouts.reduce((sum, tryout) => {
    const roster = Array.isArray(tryout.roster) ? tryout.roster : []
    return sum + roster.length
  }, 0)
  const planUpdatedMs = toDateLikeMs(profile.planUpdatedAt)
  const subscriptionEndsMs = toDateLikeMs(profile.subscriptionEndsAt)

  return {
    userId,
    email: loginEmail,
    displayName: getProfileDisplayName(profile) || loginEmail || '',
    planTier,
    teamCount,
    assessmentCount,
    playerCount,
    lastActiveDate: toIso(lastActiveMs),
    accountCreatedDate: toIso(createdAtMs),
    seasonsCount: Object.keys(blobSeasons).length,
    planUpdatedAt: toIso(planUpdatedMs),
    subscriptionEndsAt: toIso(subscriptionEndsMs),
    profile,
  }
}

export const loadUserDetail = async (userId: string) => {
  const profile = await loadProfile(userId)
  const blobSeasons = await loadBlobSeasons(userId)
  const sqlStats = await getSqlStatsByUser(userId)
  const identityUsers = await loadIdentityUsers()
  const identityEmail = identityUsers.find((row) => String(row.userId || '').trim() === userId)?.email || ''
  const loginEmail = resolveLoginEmail(
    getProfileEmail(profile),
    identityEmail,
    getEmailFromUserId(userId),
    getEmailFromSeasons(blobSeasons)
  )

  return {
    userId,
    email: loginEmail,
    profile,
    planTier: normalizePlanTier(profile.planTier || profile.plan || profile.subscriptionTier),
    seasons: blobSeasons,
    assessments: sqlStats.tryouts,
    teams: sqlStats.teams,
    sqlSeasons: sqlStats.seasons,
    planHistory: Array.isArray(profile.planHistory) ? profile.planHistory : [],
  }
}

const auditKeyForDay = (date = new Date()) => `audit/${date.toISOString().slice(0, 10)}.json`

export const writeAuditLog = async (entry: Record<string, unknown>) => {
  try {
    const key = auditKeyForDay()
    const existing = await adminStore.get(key, { type: 'json' })
    const rows = Array.isArray(existing) ? (existing as Record<string, unknown>[]) : []
    rows.push({ ...entry, timestamp: new Date().toISOString() })
    await adminStore.setJSON(key, rows)
  } catch {
    // Audit logging must never break the main request path.
  }
}

export const listAuditLogs = async (hours = 24) => {
  const entries: Record<string, unknown>[] = []
  const now = Date.now()
  const cutoff = now - hours * 60 * 60 * 1000

  for (let day = 0; day < 8; day += 1) {
    const dt = new Date(now - day * 24 * 60 * 60 * 1000)
    const key = auditKeyForDay(dt)
    const existing = await adminStore.get(key, { type: 'json' })
    if (!Array.isArray(existing)) continue
    for (const row of existing) {
      if (!row || typeof row !== 'object') continue
      const timestamp = toDateLikeMs((row as Record<string, unknown>).timestamp)
      if (timestamp && timestamp >= cutoff) {
        entries.push(row as Record<string, unknown>)
      }
    }
  }

  return entries
}

export const listAuditLogsRange = async (fromMs: number, toMs: number) => {
  const entries: Record<string, unknown>[] = []
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return entries

  const startDay = new Date(fromMs)
  startDay.setUTCHours(0, 0, 0, 0)
  const endDay = new Date(toMs)
  endDay.setUTCHours(0, 0, 0, 0)

  for (let dayMs = startDay.getTime(); dayMs <= endDay.getTime(); dayMs += 24 * 60 * 60 * 1000) {
    const key = auditKeyForDay(new Date(dayMs))
    const existing = await adminStore.get(key, { type: 'json' })
    if (!Array.isArray(existing)) continue
    for (const row of existing) {
      if (!row || typeof row !== 'object') continue
      const timestamp = toDateLikeMs((row as Record<string, unknown>).timestamp)
      if (!timestamp) continue
      if (timestamp < fromMs || timestamp > toMs) continue
      entries.push(row as Record<string, unknown>)
    }
  }
  return entries
}

export const extractAdminClaims = (req: Request, _context?: Context) => {
  const auth = requireAdminOr401(req)
  return auth
}
