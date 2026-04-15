import type { Config } from '@netlify/functions'
import {
  enterpriseStore,
  generateId,
  isSuperAdminEmail,
  jsonRes,
  loadOrgAdmins,
  loadOrgConfig,
  readBody,
  saveOrgAdmins,
  saveOrgConfig,
  writeEnterpriseAudit,
  type EnterpriseRole,
  type OrgConfig,
} from './_enterprise.mts'

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

const getBearerToken = (req: Request) => {
  const h = req.headers.get('authorization') || ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed.' }, 405)

  const body = await readBody(req)
  const mode = String(body.mode || '').trim().toLowerCase()
  const orgSlug = String(body.orgSlug || '').trim().toLowerCase()
  const token = getBearerToken(req)

  // ── STATUS: check if token + org are valid ──────────────────────────────────
  if (mode === 'status') {
    if (!token || !orgSlug) return jsonRes({ ok: false })
    const claims = decodeJwtPayload(token)
    if (!claims) return jsonRes({ ok: false })
    const exp = Number(claims.exp || 0)
    if (exp && exp < Math.floor(Date.now() / 1000)) return jsonRes({ ok: false, reason: 'expired' })
    const email = String(claims.email || '').trim().toLowerCase()
    // Super-admin: always valid — check before org existence so they can access even if org not yet created
    if (isSuperAdminEmail(email)) {
      const orgConfig = await loadOrgConfig(orgSlug)
      if (!orgConfig) return jsonRes({ ok: true, role: 'owner', orgName: orgSlug, email, isSuperAdmin: true, noOrg: true })
      return jsonRes({ ok: true, role: 'owner', orgName: orgConfig.orgName, email, isSuperAdmin: true })
    }
    const orgConfig = await loadOrgConfig(orgSlug)
    if (!orgConfig) return jsonRes({ ok: false, reason: 'org_not_found' })
    const admins = await loadOrgAdmins(orgSlug)
    const admin = admins.find(a => a.email === email && a.status === 'active')
    if (!admin) return jsonRes({ ok: false, reason: 'not_admin' })
    return jsonRes({ ok: true, role: admin.role, orgName: orgConfig.orgName, email })
  }

  // ── LOGIN: authenticate against org ────────────────────────────────────────
  if (mode === 'login') {
    if (!token) return jsonRes({ error: 'No identity token provided.' }, 401)
    if (!orgSlug) return jsonRes({ error: 'Organization slug is required.' }, 400)

    const claims = decodeJwtPayload(token)
    if (!claims) return jsonRes({ error: 'Invalid identity token.' }, 401)

    const exp = Number(claims.exp || 0)
    if (exp && exp < Math.floor(Date.now() / 1000)) return jsonRes({ error: 'Identity token expired.' }, 401)

    const email = String(claims.email || '').trim().toLowerCase()
    if (!email) return jsonRes({ error: 'Identity token missing email.' }, 401)

    // Super-admin: bypass org existence check so they can log in even before any org is created
    if (isSuperAdminEmail(email)) {
      const orgConfig = await loadOrgConfig(orgSlug)
      if (!orgConfig) {
        // Org doesn't exist yet — let super-admin in so they can create it
        return jsonRes({
          ok: true,
          email,
          name: 'Super Admin',
          role: 'owner',
          orgSlug,
          orgName: orgSlug,
          orgConfig: null,
          isSuperAdmin: true,
          noOrg: true,
        })
      }
      await writeEnterpriseAudit(orgSlug, {
        action: 'enterprise_login_success',
        email,
        role: 'owner',
        note: 'super_admin',
      })
      return jsonRes({
        ok: true,
        email,
        name: 'Super Admin',
        role: 'owner',
        orgSlug,
        orgName: orgConfig.orgName,
        orgConfig,
        isSuperAdmin: true,
      })
    }

    const orgConfig = await loadOrgConfig(orgSlug)
    if (!orgConfig) return jsonRes({ error: 'Organization not found. Check your slug.' }, 404)

    const admins = await loadOrgAdmins(orgSlug)
    const admin = admins.find(a => a.email === email)

    if (!admin) {
      await writeEnterpriseAudit(orgSlug, {
        action: 'enterprise_login_failed',
        email,
        reason: 'not_in_admin_list',
      })
      return jsonRes({ error: 'Your account does not have access to this organization.' }, 403)
    }

    if (admin.status === 'suspended') {
      await writeEnterpriseAudit(orgSlug, {
        action: 'enterprise_login_failed',
        email,
        reason: 'suspended',
      })
      return jsonRes({ error: 'Your account has been suspended.' }, 403)
    }

    if (admin.status === 'invited') {
      // Accept the invite on first login
      const idx = admins.findIndex(a => a.email === email)
      admins[idx] = { ...admin, status: 'active', acceptedAt: Date.now() }
      await saveOrgAdmins(orgSlug, admins)
    }

    await writeEnterpriseAudit(orgSlug, {
      action: 'enterprise_login_success',
      email,
      role: admin.role,
    })

    return jsonRes({
      ok: true,
      email,
      name: admin.name,
      role: admin.role,
      orgSlug,
      orgName: orgConfig.orgName,
      orgConfig,
    })
  }

  // ── SETUP: bootstrap a new organization (super-admin only) ─────────────────
  if (mode === 'setup') {
    const superAdminEmail = Netlify.env.get('SUPER_ADMIN_EMAIL') || 'shawngilbert047@gmail.com'
    const claims = decodeJwtPayload(token)
    const callerEmail = String(claims?.email || '').trim().toLowerCase()
    if (callerEmail !== superAdminEmail.trim().toLowerCase()) {
      return jsonRes({ error: 'Unauthorized.' }, 401)
    }

    if (!orgSlug || !/^[a-z0-9-]{2,40}$/.test(orgSlug)) {
      return jsonRes({ error: 'Invalid org slug. Use 2-40 lowercase letters, numbers, or hyphens.' }, 400)
    }

    const existing = await loadOrgConfig(orgSlug)
    if (existing) return jsonRes({ error: 'Organization already exists.' }, 409)

    const orgName = String(body.orgName || '').trim()
    const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase()
    const ownerName = String(body.ownerName || '').trim()
    const sport = String(body.sport || 'Hockey').trim()
    const memberUserIds = Array.isArray(body.memberUserIds)
      ? (body.memberUserIds as unknown[]).map(id => String(id || '').trim()).filter(Boolean)
      : []

    if (!orgName) return jsonRes({ error: 'orgName is required.' }, 400)
    if (!ownerEmail || !ownerEmail.includes('@')) return jsonRes({ error: 'Valid ownerEmail is required.' }, 400)

    const now = Date.now()
    const newConfig: OrgConfig = {
      orgSlug,
      orgName,
      sport,
      primaryColor: '#f97316',
      logoUrl: '',
      contactEmail: ownerEmail,
      contactName: ownerName,
      address: '',
      timezone: 'America/Toronto',
      fiscalYearStartMonth: 1,
      memberUserIds,
      planTier: 'organization',
      currency: 'CAD',
      taxEnabled: false,
      taxRate: 0,
      taxId: '',
      refundPolicyText: '',
      latePaymentThresholdDays: 30,
      paymentReminderDays: 7,
      emailFromName: `${orgName} — Tryout`,
      emailReplyTo: ownerEmail,
      mfaRequired: 'owners',
      sessionTimeoutMinutes: 480,
      ipAllowlist: [],
      loginLockoutAttempts: 5,
      createdAt: now,
      updatedAt: now,
    }

    await saveOrgConfig(orgSlug, newConfig)
    await saveOrgAdmins(orgSlug, [
      {
        email: ownerEmail,
        name: ownerName,
        role: 'owner',
        status: 'active',
        invitedAt: now,
        invitedBy: callerEmail,
        acceptedAt: now,
      },
    ])

    await writeEnterpriseAudit(orgSlug, {
      action: 'org_created',
      email: callerEmail,
      orgName,
      ownerEmail,
    })

    return jsonRes({ ok: true, orgSlug, orgName })
  }

  return jsonRes({ error: 'Unknown mode.' }, 400)
}

export const config: Config = {
  path: '/api/enterprise/auth',
  method: ['POST', 'OPTIONS'],
}
