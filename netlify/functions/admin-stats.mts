import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { ensureSchema, getSqlClient } from './_neon.mts'
import {
  getEnv,
  jsonResponse,
  listAuditLogs,
  loadAllUserIds,
  loadUserSummary,
  requireSuperAdminOr401,
} from './_admin.mts'

const PLAN_LIMITS: Record<string, number> = {
  free: 1,
  starter: 1,
  club: 2,
  pro: 5,
  organization: 12,
}

const startOfMonthSeconds = () => {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0))
  return Math.floor(start.getTime() / 1000)
}

const isoWeekStart = (date: Date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - day + 1)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

const weekLabel = (date: Date) => {
  const yr = date.getUTCFullYear()
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const da = String(date.getUTCDate()).padStart(2, '0')
  return `${yr}-${mo}-${da}`
}

const emailRegion = (email: string) => {
  const normalized = String(email || '').toLowerCase()
  const domain = normalized.split('@')[1] || ''
  if (!domain) return 'unknown'
  const parts = domain.split('.')
  if (parts.length < 2) return domain
  const tld = parts[parts.length - 1]
  if (tld === 'ca' && parts.length >= 3) {
    return parts[parts.length - 2]
  }
  return tld
}

const stripeMonthlyRevenue = async () => {
  const secret = getEnv('STRIPE_SECRET_KEY')
  if (!secret) return { amountCents: 0, currency: 'usd' }

  const params = new URLSearchParams()
  params.set('created[gte]', String(startOfMonthSeconds()))
  params.set('limit', '100')

  const res = await fetch(`https://api.stripe.com/v1/charges?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  }).catch(() => null)

  if (!res || !res.ok) return { amountCents: 0, currency: 'usd' }
  const data = (await res.json().catch(() => ({}))) as { data?: Array<Record<string, unknown>> }

  let sum = 0
  let currency = 'usd'
  for (const charge of data.data || []) {
    if (charge?.paid !== true) continue
    if (charge?.refunded === true) continue
    const amount = Number(charge.amount || 0)
    if (!Number.isFinite(amount)) continue
    sum += amount
    if (typeof charge.currency === 'string') currency = charge.currency
  }

  return { amountCents: sum, currency }
}

const feedbackStore = getStore({ name: 'feedback', consistency: 'strong' })

const scoreAverage = (values: number[]) =>
  values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : 0

export default async (req: Request) => {
  const auth = requireSuperAdminOr401(req)
  if (auth instanceof Response) return auth

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const url = new URL(req.url)
  const fromParam = String(url.searchParams.get('from') || '').trim()
  const toParam = String(url.searchParams.get('to') || '').trim()
  const fromMs = fromParam ? Date.parse(fromParam) : Date.now() - 12 * 7 * 24 * 60 * 60 * 1000
  const toMs = toParam ? Date.parse(toParam) : Date.now()

  const userRows = await loadAllUserIds()
  const users = await Promise.all(userRows.map(row => loadUserSummary(row.userId, row.identityEmail)))

  const totalUsers = users.length
  const activeUsers7d = users.filter(user => {
    const t = user.lastActiveDate ? Date.parse(user.lastActiveDate) : 0
    return t >= Date.now() - 7 * 24 * 60 * 60 * 1000
  }).length
  const activeUsers30d = users.filter(user => {
    const t = user.lastActiveDate ? Date.parse(user.lastActiveDate) : 0
    return t >= Date.now() - 30 * 24 * 60 * 60 * 1000
  }).length

  const planDistribution = users.reduce<Record<string, number>>((acc, user) => {
    const tier = String(user.planTier || 'free').toLowerCase()
    acc[tier] = (acc[tier] || 0) + 1
    return acc
  }, {})

  const newSignupsThisWeek = users.filter(user => {
    const t = user.accountCreatedDate ? Date.parse(user.accountCreatedDate) : 0
    return t >= Date.now() - 7 * 24 * 60 * 60 * 1000
  }).length

  const weeklySignupsMap = new Map<string, number>()
  for (let i = 11; i >= 0; i -= 1) {
    const dt = new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000)
    weeklySignupsMap.set(weekLabel(isoWeekStart(dt)), 0)
  }
  for (const user of users) {
    const ts = user.accountCreatedDate ? Date.parse(user.accountCreatedDate) : 0
    if (!ts || ts < fromMs || ts > toMs) continue
    const key = weekLabel(isoWeekStart(new Date(ts)))
    if (weeklySignupsMap.has(key)) {
      weeklySignupsMap.set(key, Number(weeklySignupsMap.get(key) || 0) + 1)
    }
  }

  const sql = getSqlClient()
  let totalAssessments = users.reduce((sum, user) => sum + Number(user.assessmentCount || 0), 0)
  let totalPlayers = 0
  let totalTeamsCreated = users.reduce((sum, user) => sum + Number(user.seasonsCount || 0), 0)
  const sportCounts: Record<string, number> = {}
  const qrUsers = new Set<string>()
  const cloudSyncUsers = new Set<string>()
  const guardianPortalUsers = new Set<string>()
  const teamBuilderUsers = new Set<string>()
  const seasonBuilderUsers = new Set<string>()

  for (const user of users) {
    if (Number(user.teamCount || 0) > 0) teamBuilderUsers.add(String(user.userId || ''))
    if (Number(user.seasonsCount || 0) > 0) seasonBuilderUsers.add(String(user.userId || ''))
  }

  const topUsersByAssessments = [...users]
    .sort((a, b) => Number(b.assessmentCount || 0) - Number(a.assessmentCount || 0))
    .slice(0, 10)
    .map(user => ({
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      assessmentCount: user.assessmentCount,
      planTier: user.planTier,
    }))

  if (sql) {
    await ensureSchema(sql)
    const countRows = await sql<{ total: number }[]>`
      select count(*)::int as total
      from tryouts
    `
    totalAssessments = Number(countRows[0]?.total || totalAssessments)

    const playerRows = await sql<{ players: number }[]>`
      select coalesce(sum(jsonb_array_length(coalesce(payload->'roster', '[]'::jsonb))), 0)::int as players
      from tryouts
    `
    totalPlayers = Number(playerRows[0]?.players || 0)

    const seasonRows = await sql<{ total: number }[]>`
      select count(*)::int as total
      from seasons
    `
    totalTeamsCreated = Number(seasonRows[0]?.total || totalTeamsCreated)

    const sportRows = await sql<{ sport: string; count: number }[]>`
      select lower(coalesce(payload->>'sport', 'unknown')) as sport, count(*)::int as count
      from tryouts
      group by 1
      order by count desc
    `
    for (const row of sportRows) {
      sportCounts[row.sport || 'unknown'] = Number(row.count || 0)
    }

    const tryoutRows = await sql<{ user_id: string; payload: unknown }[]>`
      select user_id, payload
      from tryouts
    `
    for (const row of tryoutRows) {
      const userId = String(row.user_id || '').trim()
      if (!userId || !row.payload || typeof row.payload !== 'object') continue
      const payload = row.payload as Record<string, unknown>
      const roster = Array.isArray(payload.roster) ? payload.roster : []
      if (roster.some(player => String((player as Record<string, unknown>)?.registrationSource || '').toLowerCase() === 'qr')) {
        qrUsers.add(userId)
      }
      const cloud = payload.cloud && typeof payload.cloud === 'object' ? (payload.cloud as Record<string, unknown>) : null
      if (cloud && String(cloud.id || '').trim()) cloudSyncUsers.add(userId)
    }

    const seasonPayloadRows = await sql<{ user_id: string; payload: unknown }[]>`
      select user_id, payload
      from seasons
    `
    for (const row of seasonPayloadRows) {
      const userId = String(row.user_id || '').trim()
      if (!userId || !row.payload || typeof row.payload !== 'object') continue
      const payload = row.payload as Record<string, unknown>
      const roster = Array.isArray(payload.roster) ? payload.roster : []
      const usedPortal = roster.some((player) => {
        const value = player && typeof player === 'object' ? (player as Record<string, unknown>) : {}
        const invited = Array.isArray(value.portalInviteEmails) ? value.portalInviteEmails.length : 0
        const sent = Number(value.portalInviteSentAt || 0)
        return invited > 0 || sent > 0
      })
      if (usedPortal) guardianPortalUsers.add(userId)
    }
  }

  const avgPlayersPerAssessment = totalAssessments > 0 ? Number((totalPlayers / totalAssessments).toFixed(2)) : 0
  const avgAssessmentsPerUser = totalUsers > 0 ? Number((totalAssessments / totalUsers).toFixed(2)) : 0

  const overLimitUsers = users
    .map(user => {
      const tier = String(user.planTier || 'free').toLowerCase()
      const limit = PLAN_LIMITS[tier] ?? 1
      const teams = Number(user.teamCount || 0)
      return { ...user, overBy: teams - limit, teamLimit: limit }
    })
    .filter(user => user.overBy > 0)
    .sort((a, b) => b.overBy - a.overBy)

  const regionDistribution = users.reduce<Record<string, number>>((acc, user) => {
    const region = emailRegion(String(user.email || ''))
    acc[region] = (acc[region] || 0) + 1
    return acc
  }, {})

  const revenue = await stripeMonthlyRevenue()
  // Annual prices divided by 12 to get true monthly recurring revenue
  const mrrByTier: Record<string, number> = {
    free: 0,
    coach: 29.99 / 12,
    club: 59.99 / 12,
    pro: 99.99 / 12,
    association: 249.99 / 12
  }
  const monthlyRecurringRevenue = Number(
    Object.entries(planDistribution)
      .reduce((sum, [tier, count]) => sum + (mrrByTier[String(tier || 'free').toLowerCase()] || 0) * Number(count || 0), 0)
      .toFixed(2)
  )

  const audit24h = await listAuditLogs(24)
  const functionErrorsLast24h = audit24h.filter(row => {
    const statusCode = Number(row.statusCode || 0)
    const status = String(row.status || '').toLowerCase()
    return statusCode >= 400 || status === 'failed'
  })
  const failedFunctionCallsLast24h = functionErrorsLast24h.length
  const lastSuccessfulCloudSync = audit24h
    .filter(row => String(row.action || '') === 'cloud_sync' && String(row.status || '') === 'ok')
    .sort((a, b) => Date.parse(String(b.timestamp || '')) - Date.parse(String(a.timestamp || '')))[0]?.timestamp || null

  const feedbackRaw = await feedbackStore.get('feedback/all', { type: 'json' })
  const feedbackRows = Array.isArray(feedbackRaw) ? feedbackRaw : []
  const totalFeedbackSubmissions = feedbackRows.length
  const question1Scores = feedbackRows
    .map(row => Number(((row as Record<string, unknown>)?.ratings as Record<string, unknown>)?.overallExperience || 0))
    .filter(value => value >= 1 && value <= 5)
  const avgOverallFeedbackRating = scoreAverage(question1Scores)

  const dailyActiveMap = new Map<string, number>()
  for (let i = 29; i >= 0; i -= 1) {
    const dt = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    const key = dt.toISOString().slice(0, 10)
    dailyActiveMap.set(key, 0)
  }
  for (const user of users) {
    const t = user.lastActiveDate ? Date.parse(user.lastActiveDate) : 0
    if (!t) continue
    const key = new Date(t).toISOString().slice(0, 10)
    if (!dailyActiveMap.has(key)) continue
    dailyActiveMap.set(key, Number(dailyActiveMap.get(key) || 0) + 1)
  }

  return jsonResponse({
    totalUsers,
    activeUsers7d,
    activeUsers30d,
    totalTeamsCreated,
    totalAssessments,
    totalPlayers,
    planDistribution,
    revenueThisMonth: {
      amountCents: revenue.amountCents,
      currency: revenue.currency,
      amount: Number((revenue.amountCents / 100).toFixed(2)),
    },
    newSignupsThisWeek,
    totalFeedbackSubmissions,
    avgOverallFeedbackRating,
    functionErrorsLast24h,
    failedFunctionCallsLast24h,
    lastSuccessfulCloudSync,
    monthlyRecurringRevenue,
    analytics: {
      dateRange: {
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
      },
      newUserSignupsPerWeek: Array.from(weeklySignupsMap.entries()).map(([weekStart, count]) => ({ weekStart, count })),
      dailyActiveUsers: Array.from(dailyActiveMap.entries()).map(([date, count]) => ({ date, count })),
      planTierDistribution: planDistribution,
      mostActiveSportsByAssessmentCount: sportCounts,
      averagePlayersPerAssessment: avgPlayersPerAssessment,
      averageAssessmentsPerUser: avgAssessmentsPerUser,
      topActiveUsersByAssessmentCount: topUsersByAssessments,
      geographicDistribution: regionDistribution,
      usersOverPlanLimits: overLimitUsers,
      featureUsageBreakdown: {
        qrRegistration: qrUsers.size,
        cloudSync: cloudSyncUsers.size,
        teamBuilder: teamBuilderUsers.size,
        seasonBuilder: seasonBuilderUsers.size,
        guardianPortal: guardianPortalUsers.size,
      },
    },
  })
}

export const config: Config = {
  path: '/api/admin/stats',
  method: 'GET',
}
