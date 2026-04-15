import type { Config } from '@netlify/functions'
import {
  jsonResponse,
  readJsonBody,
  requireSuperAdminOr401,
  seasonStore,
  writeAuditLog,
} from './_admin.mts'

const VALID_TIERS = new Set(['free', 'starter', 'club', 'pro', 'organization'])

const normalizeTier = (value: unknown) => {
  const tier = String(value || '').trim().toLowerCase()
  return VALID_TIERS.has(tier) ? tier : ''
}

export default async (req: Request) => {
  const auth = requireSuperAdminOr401(req)
  if (auth instanceof Response) return auth

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const body = await readJsonBody(req)
  const userId = String(body?.userId || '').trim()
  const nextTier = normalizeTier(body?.planTier)
  const reason = String(body?.reason || '').trim()
  const complimentary = body?.complimentary === true
  const extensionDays = Math.max(0, Number(body?.extendDays || 0) || 0)

  if (!userId || !nextTier) {
    return jsonResponse({ error: 'userId and valid planTier are required.' }, { status: 400 })
  }
  if (!reason) {
    return jsonResponse({ error: 'Reason is required.' }, { status: 400 })
  }

  const profileKey = `users/${userId}/profile`
  const profile = (await seasonStore.get(profileKey, { type: 'json' }).catch(() => null)) as
    | Record<string, unknown>
    | null

  const current = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {}
  const previousTier = String(current.planTier || current.plan || 'free').toLowerCase()

  const now = Date.now()
  const existingUntil = Number(current.subscriptionEndsAt || 0) || 0
  const subscriptionEndsAt = extensionDays
    ? Math.max(now, existingUntil) + extensionDays * 24 * 60 * 60 * 1000
    : existingUntil || null

  const planHistory = Array.isArray(current.planHistory)
    ? [...current.planHistory]
    : []

  planHistory.push({
    timestamp: new Date().toISOString(),
    previousTier,
    nextTier,
    reason,
    complimentary,
    extensionDays,
    adminEmail: auth.email,
  })

  const updatedProfile: Record<string, unknown> = {
    ...current,
    planTier: nextTier,
    subscriptionTier: nextTier,
    complimentaryPlan: complimentary,
    planUpdatedAt: new Date().toISOString(),
    planHistory,
  }

  if (subscriptionEndsAt) {
    updatedProfile.subscriptionEndsAt = subscriptionEndsAt
  }

  await seasonStore.setJSON(profileKey, updatedProfile)

  await writeAuditLog({
    action: 'plan_override',
    status: 'ok',
    adminEmail: auth.email,
    userId,
    previousTier,
    nextTier,
    reason,
    complimentary,
    extensionDays,
  })

  return jsonResponse({
    ok: true,
    userId,
    previousTier,
    nextTier,
    subscriptionEndsAt: subscriptionEndsAt ? new Date(subscriptionEndsAt).toISOString() : null,
  })
}

export const config: Config = {
  path: '/api/admin/plan-override',
  method: 'POST',
}
