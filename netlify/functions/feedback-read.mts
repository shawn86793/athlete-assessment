import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { jsonResponse, loadAllUserIds, loadUserSummary, requireSuperAdminOr401 } from './_admin.mts'

type FeedbackRecord = {
  id?: string
  submittedAt?: string
  [key: string]: unknown
}

const feedbackStore = getStore({ name: 'feedback', consistency: 'strong' })

const toMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export default async (req: Request) => {
  const auth = requireSuperAdminOr401(req)
  if (auth instanceof Response) return auth

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const url = new URL(req.url)
  const fromRaw = String(url.searchParams.get('from') || '').trim()
  const toRaw = String(url.searchParams.get('to') || '').trim()
  const sportFilter = String(url.searchParams.get('sport') || '').trim().toLowerCase()
  const planFilter = String(url.searchParams.get('plan') || '').trim().toLowerCase()
  const fromMs = fromRaw ? toMs(fromRaw) : 0
  const toMsValue = toRaw ? toMs(toRaw) : 0

  const allRaw = await feedbackStore.get('feedback/all', { type: 'json' })
  const all = (Array.isArray(allRaw) ? allRaw : []) as FeedbackRecord[]

  const userRows = await loadAllUserIds()
  const userSummaries = await Promise.all(userRows.map(row => loadUserSummary(row.userId, row.identityEmail)))
  const byUserId = new Map<string, Record<string, unknown>>()
  const byEmail = new Map<string, Record<string, unknown>>()
  for (const row of userSummaries as unknown as Record<string, unknown>[]) {
    const userId = String(row.userId || '').trim()
    const email = String(row.email || '').trim().toLowerCase()
    if (userId) byUserId.set(userId, row)
    if (email) byEmail.set(email, row)
  }

  const withPlan = all.map(item => {
    const userId = String(item.userId || '').trim()
    const userEmail = String(item.userEmail || '').trim().toLowerCase()
    const user = (userId ? byUserId.get(userId) : null) || (userEmail ? byEmail.get(userEmail) : null) || null
    const planTier = String(user?.planTier || 'free').toLowerCase()
    return {
      ...item,
      planTier,
    }
  })

  const filtered = withPlan.filter(item => {
    const submittedMs = toMs(item?.submittedAt)
    if (!submittedMs) return false
    if (fromMs && submittedMs < fromMs) return false
    if (toMsValue && submittedMs > toMsValue) return false
    if (sportFilter && String(item?.seasonSport || '').toLowerCase() !== sportFilter) return false
    if (planFilter && String((item as Record<string, unknown>)?.planTier || '').toLowerCase() !== planFilter) return false
    return true
  })

  filtered.sort((a, b) => toMs(b.submittedAt) - toMs(a.submittedAt))

  return jsonResponse({
    count: filtered.length,
    feedback: filtered,
    filters: {
      from: fromMs ? new Date(fromMs).toISOString() : null,
      to: toMsValue ? new Date(toMsValue).toISOString() : null,
      sport: sportFilter || null,
      plan: planFilter || null,
    },
  })
}

export const config: Config = {
  path: '/api/admin/feedback',
  method: 'GET',
}
