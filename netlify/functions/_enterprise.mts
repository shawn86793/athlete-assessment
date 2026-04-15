import { getStore } from '@netlify/blobs'
import { ensureSchema, getSqlClient } from './_neon.mts'

// ─── Store ────────────────────────────────────────────────────────────────────

export const enterpriseStore = getStore({ name: 'enterprise', consistency: 'strong' })

// ─── Super-admin (unrestricted owner access to all orgs) ─────────────────────

export const SUPER_ADMIN_EMAIL = 'shawngilbert047@gmail.com'
export const isSuperAdminEmail = (email: string) =>
  email.trim().toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()

// ─── Types ────────────────────────────────────────────────────────────────────

export type EnterpriseRole = 'viewer' | 'staff' | 'manager' | 'owner'

export type OrgAdmin = {
  email: string
  name: string
  role: EnterpriseRole
  status: 'active' | 'invited' | 'suspended'
  invitedAt: number
  invitedBy: string
  acceptedAt?: number
  mfaEnabled?: boolean
}

export type OrgConfig = {
  orgSlug: string
  orgName: string
  sport: string
  primaryColor: string
  logoUrl: string
  contactEmail: string
  contactName: string
  address: string
  timezone: string
  fiscalYearStartMonth: number
  memberUserIds: string[]
  planTier: string
  currency: string
  taxEnabled: boolean
  taxRate: number
  taxId: string
  refundPolicyText: string
  latePaymentThresholdDays: number
  paymentReminderDays: number
  emailFromName: string
  emailReplyTo: string
  mfaRequired: string
  sessionTimeoutMinutes: number
  ipAllowlist: string[]
  loginLockoutAttempts: number
  createdAt: number
  updatedAt: number
}

export type PaymentRecord = {
  id: string
  playerName: string
  playerUserId: string
  playerId: string
  assessmentId: string
  assessmentName: string
  teamId: string
  teamName: string
  feeName: string
  amount: number
  currency: string
  method: string
  reference: string
  status: 'paid' | 'pending' | 'refunded' | 'voided' | 'complimentary'
  notes: string
  recordedBy: string
  receivedAt: number
  createdAt: number
}

export type BroadcastRecord = {
  id: string
  subject: string
  body: string
  audienceType: string
  audienceDescription: string
  recipientCount: number
  sentBy: string
  sentAt: number
  status: 'sent' | 'draft' | 'scheduled'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const jsonRes = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Content-Type': 'application/json' } })

export const readBody = async (req: Request): Promise<Record<string, unknown>> => {
  try {
    const text = await req.text()
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

const getBearerToken = (req: Request): string => {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

const getOrgSlugHeader = (req: Request): string =>
  (req.headers.get('x-org-slug') || req.headers.get('X-Org-Slug') || '').trim().toLowerCase()

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type EnterpriseAuth = {
  email: string
  role: EnterpriseRole
  orgSlug: string
  orgConfig: OrgConfig
}

export const requireEnterpriseAdmin = async (
  req: Request,
  minRole: EnterpriseRole = 'viewer',
): Promise<EnterpriseAuth | Response> => {
  const token = getBearerToken(req)
  if (!token) return jsonRes({ error: 'Unauthorized.' }, 401)

  const claims = decodeJwtPayload(token)
  if (!claims) return jsonRes({ error: 'Unauthorized.' }, 401)

  const exp = Number(claims.exp || 0)
  if (exp && exp < Math.floor(Date.now() / 1000)) return jsonRes({ error: 'Session expired.' }, 401)

  const email = String(claims.email || '').trim().toLowerCase()
  if (!email) return jsonRes({ error: 'Unauthorized.' }, 401)

  const orgSlug = getOrgSlugHeader(req)
  if (!orgSlug) return jsonRes({ error: 'Missing X-Org-Slug header.' }, 400)

  const orgConfig = await loadOrgConfig(orgSlug)
  if (!orgConfig) return jsonRes({ error: 'Organization not found.' }, 404)

  // Super-admin: unrestricted owner access to any org — no admin list required
  if (isSuperAdminEmail(email)) {
    return { email, role: 'owner', orgSlug, orgConfig }
  }

  const admins = await loadOrgAdmins(orgSlug)
  const admin = admins.find(a => a.email === email && a.status === 'active')
  if (!admin) return jsonRes({ error: 'Unauthorized.' }, 401)

  const roleOrder: EnterpriseRole[] = ['viewer', 'staff', 'manager', 'owner']
  if (roleOrder.indexOf(admin.role) < roleOrder.indexOf(minRole)) {
    return jsonRes({ error: 'Insufficient permissions.' }, 403)
  }

  return { email, role: admin.role, orgSlug, orgConfig }
}

// ─── Org Config ───────────────────────────────────────────────────────────────

export const loadOrgConfig = async (orgSlug: string): Promise<OrgConfig | null> => {
  try {
    const raw = await enterpriseStore.get(`orgs/${orgSlug}/config`, { type: 'json' })
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw as OrgConfig
  } catch {
    return null
  }
}

export const saveOrgConfig = async (orgSlug: string, config: OrgConfig): Promise<void> => {
  await enterpriseStore.setJSON(`orgs/${orgSlug}/config`, { ...config, updatedAt: Date.now() })
}

// ─── Org Admins ───────────────────────────────────────────────────────────────

export const loadOrgAdmins = async (orgSlug: string): Promise<OrgAdmin[]> => {
  try {
    const raw = await enterpriseStore.get(`orgs/${orgSlug}/admins`, { type: 'json' })
    return Array.isArray(raw) ? (raw as OrgAdmin[]) : []
  } catch {
    return []
  }
}

export const saveOrgAdmins = async (orgSlug: string, admins: OrgAdmin[]): Promise<void> => {
  await enterpriseStore.setJSON(`orgs/${orgSlug}/admins`, admins)
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export const loadOrgPayments = async (orgSlug: string): Promise<PaymentRecord[]> => {
  try {
    const raw = await enterpriseStore.get(`orgs/${orgSlug}/payments`, { type: 'json' })
    return Array.isArray(raw) ? (raw as PaymentRecord[]) : []
  } catch {
    return []
  }
}

export const saveOrgPayments = async (orgSlug: string, payments: PaymentRecord[]): Promise<void> => {
  await enterpriseStore.setJSON(`orgs/${orgSlug}/payments`, payments)
}

// ─── Broadcasts ───────────────────────────────────────────────────────────────

export const loadOrgBroadcasts = async (orgSlug: string): Promise<BroadcastRecord[]> => {
  try {
    const raw = await enterpriseStore.get(`orgs/${orgSlug}/broadcasts`, { type: 'json' })
    return Array.isArray(raw) ? (raw as BroadcastRecord[]) : []
  } catch {
    return []
  }
}

export const saveOrgBroadcasts = async (orgSlug: string, records: BroadcastRecord[]): Promise<void> => {
  await enterpriseStore.setJSON(`orgs/${orgSlug}/broadcasts`, records)
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const writeEnterpriseAudit = async (orgSlug: string, entry: Record<string, unknown>): Promise<void> => {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const key = `orgs/${orgSlug}/audit/${today}`
    const existing = await enterpriseStore.get(key, { type: 'json' })
    const rows = Array.isArray(existing) ? (existing as Record<string, unknown>[]) : []
    rows.push({ ...entry, timestamp: new Date().toISOString() })
    await enterpriseStore.setJSON(key, rows)
  } catch {
    // audit must never break main path
  }
}

export const loadEnterpriseAuditRange = async (
  orgSlug: string,
  fromMs: number,
  toMs: number,
): Promise<Record<string, unknown>[]> => {
  const entries: Record<string, unknown>[] = []
  const startDay = new Date(fromMs)
  startDay.setUTCHours(0, 0, 0, 0)
  const endDay = new Date(toMs)
  endDay.setUTCHours(0, 0, 0, 0)
  for (let ms = startDay.getTime(); ms <= endDay.getTime(); ms += 86400000) {
    const key = `orgs/${orgSlug}/audit/${new Date(ms).toISOString().slice(0, 10)}`
    try {
      const raw = await enterpriseStore.get(key, { type: 'json' })
      if (!Array.isArray(raw)) continue
      for (const row of raw as Record<string, unknown>[]) {
        const ts = Date.parse(String(row.timestamp || ''))
        if (Number.isFinite(ts) && ts >= fromMs && ts <= toMs) entries.push(row)
      }
    } catch {
      continue
    }
  }
  return entries.sort((a, b) => Date.parse(String(b.timestamp || '')) - Date.parse(String(a.timestamp || '')))
}

// ─── Neon Data Loaders ────────────────────────────────────────────────────────

export const getOrgPlayers = async (memberUserIds: string[]) => {
  if (!memberUserIds.length) return []
  const sql = getSqlClient()
  if (!sql) return []
  await ensureSchema(sql)
  const players: Record<string, unknown>[] = []
  const rows = await sql<{ user_id: string; payload: unknown }[]>`
    select user_id, payload from tryouts
    where user_id = any(${memberUserIds})
  `
  for (const row of rows) {
    const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {}
    const roster = Array.isArray(payload.roster) ? (payload.roster as Record<string, unknown>[]) : []
    for (const player of roster) {
      players.push({
        ...player,
        _userId: row.user_id,
        _assessmentId: String(payload.id || ''),
        _assessmentName: String(payload.name || ''),
        _sport: String(payload.sport || ''),
      })
    }
  }
  return players
}

export const getOrgAssessments = async (memberUserIds: string[]) => {
  if (!memberUserIds.length) return []
  const sql = getSqlClient()
  if (!sql) return []
  await ensureSchema(sql)
  const rows = await sql<{ user_id: string; payload: unknown; updated_at: string }[]>`
    select user_id, payload, updated_at from tryouts
    where user_id = any(${memberUserIds})
    order by updated_at desc
  `
  return rows.map(row => ({
    ...(row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {}),
    _userId: row.user_id,
    _updatedAt: row.updated_at,
  }))
}

export const getOrgTeams = async (memberUserIds: string[]) => {
  if (!memberUserIds.length) return []
  const sql = getSqlClient()
  if (!sql) return []
  await ensureSchema(sql)
  const rows = await sql<{ user_id: string; payload: unknown }[]>`
    select user_id, payload from seasons
    where user_id = any(${memberUserIds})
  `
  return rows.map(row => ({
    ...(row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {}),
    _userId: row.user_id,
  }))
}

// ─── ID Generator ─────────────────────────────────────────────────────────────

export const generateId = (prefix = 'ent') => {
  const bytes = new Uint8Array(8)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return `${prefix}_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`
}
