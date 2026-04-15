import type { Config, Context } from '@netlify/functions'
import { getEnv, jsonResponse, loadUserDetail, requireSuperAdminOr401 } from './_admin.mts'

const toPlayerCount = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  const row = value as Record<string, unknown>
  if (Array.isArray(row.roster)) return row.roster.length
  if (Array.isArray(row.players)) return row.players.length
  return 0
}

const toEvalCount = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  const row = value as Record<string, unknown>
  if (Array.isArray(row.evals)) return row.evals.length
  return 0
}

const loadStripePayments = async (customerId: string) => {
  const secret = getEnv('STRIPE_SECRET_KEY')
  if (!secret || !customerId) return []
  const params = new URLSearchParams()
  params.set('customer', customerId)
  params.set('limit', '25')

  const res = await fetch(`https://api.stripe.com/v1/charges?${params.toString()}`, {
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => null)
  if (!res || !res.ok) return []

  const payload = (await res.json().catch(() => ({}))) as {
    data?: Array<Record<string, unknown>>
  }
  return (payload.data || []).map(charge => ({
    id: charge.id,
    amount: Number(charge.amount || 0) / 100,
    currency: charge.currency || 'usd',
    paid: charge.paid === true,
    refunded: charge.refunded === true,
    created: typeof charge.created === 'number' ? new Date(charge.created * 1000).toISOString() : null,
    description: charge.description || '',
  }))
}

export default async (req: Request, context: Context) => {
  const auth = requireSuperAdminOr401(req)
  if (auth instanceof Response) return auth

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const userId = String(context.params?.id || '').trim()
  if (!userId) {
    return jsonResponse({ error: 'User id is required.' }, { status: 400 })
  }

  const detail = await loadUserDetail(userId)
  const loginEmail = String(
    (detail.profile as Record<string,unknown>)?.email ||
    (detail.profile as Record<string,unknown>)?.userEmail ||
    (userId.includes('@') ? userId : '')
  ).trim().toLowerCase()
  const customerId = String(
    (detail.profile as Record<string, unknown>)?.stripeCustomerId ||
      (detail.profile as Record<string, unknown>)?.customerId ||
      ''
  ).trim()
  const payments = customerId ? await loadStripePayments(customerId) : []
  const stripeConfigured = !!getEnv('STRIPE_SECRET_KEY')

  const seasonsWithPlayers = Object.entries(
    detail.seasons && typeof detail.seasons === 'object' ? detail.seasons : {}
  ).map(([id, season]) => ({
    id,
    name: String((season as Record<string, unknown>)?.teamName || (season as Record<string, unknown>)?.name || id),
    sport: String((season as Record<string, unknown>)?.sport || ''),
    year: String((season as Record<string, unknown>)?.year || ''),
    playerCount: toPlayerCount(season),
  }))

  const teamsWithPlayers = (Array.isArray(detail.teams) ? detail.teams : []).map((team) => ({
    id: String((team as Record<string, unknown>)?.id || ''),
    name: String((team as Record<string, unknown>)?.name || (team as Record<string, unknown>)?.teamName || 'Team'),
    playerCount: toPlayerCount(team),
  }))

  const assessmentsWithEvalCounts = (Array.isArray(detail.assessments) ? detail.assessments : []).map((assessment) => ({
    id: String((assessment as Record<string, unknown>)?.id || ''),
    name: String((assessment as Record<string, unknown>)?.name || 'Assessment'),
    sport: String((assessment as Record<string, unknown>)?.sport || ''),
    evalCount: toEvalCount(assessment),
    playerCount: toPlayerCount(assessment),
  }))

  return jsonResponse({
    loginEmail,
    ...detail,
    seasonsWithPlayers,
    teamsWithPlayers,
    assessmentsWithEvalCounts,
    stripeConfigured,
    stripe: {
      customerId: customerId || null,
      payments,
    },
  })
}

export const config: Config = {
  path: '/api/admin/user/:id',
  method: 'GET',
}
