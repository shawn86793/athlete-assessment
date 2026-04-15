import type { Config } from '@netlify/functions'
import {
  getOrgAssessments,
  getOrgPlayers,
  getOrgTeams,
  jsonRes,
  loadOrgAdmins,
  loadOrgPayments,
  readBody,
  requireEnterpriseAdmin,
  saveOrgConfig,
  writeEnterpriseAudit,
  loadEnterpriseAuditRange,
  type OrgConfig,
} from './_enterprise.mts'

// ─── Home Dashboard ───────────────────────────────────────────────────────────

const buildHomeDashboard = async (orgConfig: OrgConfig) => {
  const { memberUserIds } = orgConfig
  const [players, assessments, teams, payments] = await Promise.all([
    getOrgPlayers(memberUserIds),
    getOrgAssessments(memberUserIds),
    getOrgTeams(memberUserIds),
    loadOrgPayments(orgConfig.orgSlug),
  ])

  const now = Date.now()
  const monthStart = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1).getTime()

  // Active assessments: within 30 days of today
  const activeAssessments = assessments.filter(a => {
    const d = Date.parse(String(a.tryoutDate || a.eventDate || ''))
    return Number.isFinite(d) && Math.abs(d - now) < 30 * 86400000
  })

  // Revenue this month
  const revenueThisMonth = payments
    .filter(p => p.status === 'paid' && p.createdAt >= monthStart)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0)

  // Pending payments (outstanding > 0)
  const outstandingCount = payments.filter(p => p.status === 'pending').length

  // Team health grid
  const teamHealth = teams.slice(0, 20).map(t => {
    const teamAssessments = assessments.filter(a => String(a._userId) === String(t._userId))
    const teamPlayers = players.filter(p => String(p._userId) === String(t._userId))
    const scored = teamPlayers.filter(p => {
      const evals = Array.isArray(p.evaluations) ? p.evaluations : []
      return evals.length > 0
    }).length
    const lastAct = teamAssessments.reduce((max, a) => {
      const t2 = Date.parse(String(a._updatedAt || ''))
      return Number.isFinite(t2) && t2 > max ? t2 : max
    }, 0)
    const pct = teamPlayers.length ? Math.round((scored / teamPlayers.length) * 100) : 0
    let status = 'inactive'
    if (lastAct > now - 7 * 86400000) status = 'healthy'
    else if (lastAct > now - 30 * 86400000) status = 'attention'
    return {
      id: String(t.id || t._userId || ''),
      name: String(t.teamName || t.name || 'Unnamed Team'),
      sport: String(t.sport || orgConfig.sport || ''),
      season: String(t.season || t.label || ''),
      playerCount: teamPlayers.length,
      assessmentCount: teamAssessments.length,
      lastActivityMs: lastAct,
      scoredPct: pct,
      status,
    }
  })

  // Recent audit activity (last 48h)
  const auditEntries = await loadEnterpriseAuditRange(orgConfig.orgSlug, now - 48 * 3600000, now)

  return {
    pulseCards: {
      activeRegistrations: players.length,
      revenueThisMonth: Number(revenueThisMonth.toFixed(2)),
      currency: orgConfig.currency,
      assessmentsActive: activeAssessments.length,
      pendingActions: outstandingCount,
    },
    teamHealth,
    recentActivity: auditEntries.slice(0, 30),
    totals: {
      players: players.length,
      assessments: assessments.length,
      teams: teams.length,
      payments: payments.length,
    },
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })

  const auth = await requireEnterpriseAdmin(req)
  if (auth instanceof Response) return auth

  const { orgConfig, orgSlug, email } = auth
  const url = new URL(req.url)
  const section = String(url.searchParams.get('section') || 'home').trim().toLowerCase()

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (section === 'home') {
      const data = await buildHomeDashboard(orgConfig)
      return jsonRes(data)
    }

    if (section === 'players') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase()
      const page = Math.max(1, Number(url.searchParams.get('page') || 1))
      const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize') || 50)))
      const filterYob = String(url.searchParams.get('yob') || '').trim()
      const filterPos = String(url.searchParams.get('pos') || '').trim().toLowerCase()
      const filterStatus = String(url.searchParams.get('status') || '').trim().toLowerCase()

      const players = await getOrgPlayers(orgConfig.memberUserIds)

      let filtered = players
      if (q) {
        filtered = filtered.filter(p => {
          const name = `${p.first || ''} ${p.last || ''} ${p.firstName || ''} ${p.lastName || ''}`.toLowerCase()
          const email2 = String(p.guardianEmail || p.email || '').toLowerCase()
          const jersey = String(p.jersey || '').toLowerCase()
          return name.includes(q) || email2.includes(q) || jersey.includes(q)
        })
      }
      if (filterYob) filtered = filtered.filter(p => String(p.yearOfBirth || '') === filterYob)
      if (filterPos) filtered = filtered.filter(p => String(p.pos || p.position || '').toLowerCase().includes(filterPos))
      if (filterStatus) {
        if (filterStatus === 'qr') filtered = filtered.filter(p => p.registrationSource === 'qr')
        if (filterStatus === 'manual') filtered = filtered.filter(p => p.registrationSource === 'manual')
      }

      const start = (page - 1) * pageSize
      const rows = filtered.slice(start, start + pageSize)

      return jsonRes({
        players: rows,
        total: filtered.length,
        page,
        pageSize,
        totalPages: Math.ceil(filtered.length / pageSize),
      })
    }

    if (section === 'player') {
      const id = String(url.searchParams.get('id') || '').trim()
      const userId = String(url.searchParams.get('userId') || '').trim()
      const players = await getOrgPlayers(orgConfig.memberUserIds)
      const player = players.find(
        p => String(p.id || '') === id || (userId && String(p._userId || '') === userId)
      )
      if (!player) return jsonRes({ error: 'Player not found.' }, 404)
      const payments = await loadOrgPayments(orgSlug)
      const playerPayments = payments.filter(p => p.playerId === id || p.playerUserId === userId)
      return jsonRes({ player, payments: playerPayments })
    }

    if (section === 'assessments') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase()
      const status = String(url.searchParams.get('status') || '').trim().toLowerCase()
      const assessments = await getOrgAssessments(orgConfig.memberUserIds)
      let filtered = assessments
      if (q) {
        filtered = filtered.filter(a =>
          String(a.name || '').toLowerCase().includes(q) ||
          String(a.rink || '').toLowerCase().includes(q)
        )
      }
      const now = Date.now()
      if (status === 'active') {
        filtered = filtered.filter(a => {
          const d = Date.parse(String(a.tryoutDate || ''))
          return Number.isFinite(d) && Math.abs(d - now) < 14 * 86400000
        })
      } else if (status === 'upcoming') {
        filtered = filtered.filter(a => {
          const d = Date.parse(String(a.tryoutDate || ''))
          return Number.isFinite(d) && d > now
        })
      } else if (status === 'completed') {
        filtered = filtered.filter(a => {
          const d = Date.parse(String(a.tryoutDate || ''))
          return Number.isFinite(d) && d < now - 14 * 86400000
        })
      }
      return jsonRes({ assessments: filtered, total: filtered.length })
    }

    if (section === 'teams') {
      const teams = await getOrgTeams(orgConfig.memberUserIds)
      return jsonRes({ teams, total: teams.length })
    }

    if (section === 'config') {
      const admins = await loadOrgAdmins(orgSlug)
      return jsonRes({ orgConfig, admins })
    }

    return jsonRes({ error: 'Unknown section.' }, 400)
  }

  // ── PATCH: update org config ────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (auth.role !== 'manager' && auth.role !== 'owner') {
      return jsonRes({ error: 'Manager or Owner role required.' }, 403)
    }

    const body = await readBody(req)
    const allowedKeys: (keyof OrgConfig)[] = [
      'orgName', 'sport', 'primaryColor', 'logoUrl', 'contactEmail', 'contactName',
      'address', 'timezone', 'fiscalYearStartMonth', 'currency', 'taxEnabled', 'taxRate',
      'taxId', 'refundPolicyText', 'latePaymentThresholdDays', 'paymentReminderDays',
      'emailFromName', 'emailReplyTo', 'mfaRequired', 'sessionTimeoutMinutes',
      'loginLockoutAttempts', 'memberUserIds',
    ]
    const update = { ...orgConfig }
    for (const key of allowedKeys) {
      if (key in body) (update as Record<string, unknown>)[key] = body[key]
    }

    await saveOrgConfig(orgSlug, update as OrgConfig)
    await writeEnterpriseAudit(orgSlug, {
      action: 'org_config_updated',
      email,
      changes: Object.keys(body).filter(k => allowedKeys.includes(k as keyof OrgConfig)),
    })
    return jsonRes({ ok: true, orgConfig: update })
  }

  return jsonRes({ error: 'Method not allowed.' }, 405)
}

export const config: Config = {
  path: '/api/enterprise/org',
  method: ['GET', 'PATCH', 'OPTIONS'],
}
