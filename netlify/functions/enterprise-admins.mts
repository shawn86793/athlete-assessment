import type { Config } from '@netlify/functions'
import {
  jsonRes,
  loadOrgAdmins,
  readBody,
  requireEnterpriseAdmin,
  saveOrgAdmins,
  writeEnterpriseAudit,
  type EnterpriseRole,
  type OrgAdmin,
} from './_enterprise.mts'
import { getEnv } from './_admin.mts'
import { createLogger } from './_logger.mts'

const log = createLogger('enterprise-admins')

const VALID_ROLES: EnterpriseRole[] = ['viewer', 'staff', 'manager', 'owner']

const sendInviteEmail = async (opts: {
  to: string
  orgName: string
  inviterName: string
  inviterEmail: string
  role: string
  personalMessage: string
  acceptUrl: string
}) => {
  const fromEmail = getEnv('FROM_EMAIL') || `noreply@${getEnv('URL')?.replace(/https?:\/\//, '') || 'swg47.com'}`
  const sendgridKey = getEnv('SENDGRID_API_KEY')
  const resendKey = getEnv('RESEND_API_KEY')

  const subject = `You've been invited to ${opts.orgName} Enterprise Dashboard`
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <h2 style="color:#0a1e3d;margin:0 0 8px;">Enterprise Dashboard Invitation</h2>
      <p style="color:#334155;">Hi,</p>
      <p style="color:#334155;">${opts.inviterName || opts.inviterEmail} has invited you to join the
        <strong>${opts.orgName}</strong> Enterprise Dashboard as a <strong>${opts.role}</strong>.</p>
      ${opts.personalMessage ? `<blockquote style="border-left:3px solid #f97316;padding:8px 16px;margin:16px 0;color:#555;">${opts.personalMessage}</blockquote>` : ''}
      <p style="margin:24px 0;">
        <a href="${opts.acceptUrl}" style="background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Accept Invitation</a>
      </p>
      <p style="color:#888;font-size:12px;">This link will guide you through setting up your account and signing in with your email address. The invitation is valid for 72 hours.</p>
    </div>
  `
  const text = `You've been invited to ${opts.orgName} Enterprise Dashboard as ${opts.role}.\n\nAccept here: ${opts.acceptUrl}`

  try {
    if (resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromEmail, to: [opts.to], subject, html, text }),
        signal: AbortSignal.timeout(8000),
      })
    } else if (sendgridKey) {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sendgridKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: opts.to }] }],
          from: { email: fromEmail },
          subject,
          content: [{ type: 'text/html', value: html }],
        }),
        signal: AbortSignal.timeout(8000),
      })
    }
  } catch (err) {
    log.error('Failed to send invite email', { error: String(err) })
  }
}

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })

  const auth = await requireEnterpriseAdmin(req)
  if (auth instanceof Response) return auth
  const { orgSlug, email, role, orgConfig } = auth

  const url = new URL(req.url)
  const targetEmail = String(url.searchParams.get('email') || '').trim().toLowerCase()

  // ── GET: list admin users ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const admins = await loadOrgAdmins(orgSlug)
    // Mask sensitive data for viewers
    if (role === 'viewer') {
      return jsonRes({ admins: admins.map(a => ({ ...a, email: a.email.replace(/(?<=.{2}).(?=.*@)/, '*') })) })
    }
    return jsonRes({ admins })
  }

  // ── POST: invite admin ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (role !== 'manager' && role !== 'owner') {
      return jsonRes({ error: 'Manager or Owner required to invite admins.' }, 403)
    }

    const body = await readBody(req)
    const inviteEmail = String(body.email || '').trim().toLowerCase()
    const inviteName = String(body.name || '').trim()
    const inviteRole = String(body.role || 'staff').trim().toLowerCase() as EnterpriseRole
    const personalMessage = String(body.message || '').trim()

    if (!inviteEmail || !inviteEmail.includes('@')) return jsonRes({ error: 'Valid email required.' }, 400)
    if (!VALID_ROLES.includes(inviteRole)) return jsonRes({ error: 'Invalid role.' }, 400)
    // Only owners can invite owners
    if (inviteRole === 'owner' && role !== 'owner') {
      return jsonRes({ error: 'Only Owners can invite other Owners.' }, 403)
    }

    const admins = await loadOrgAdmins(orgSlug)
    const existing = admins.find(a => a.email === inviteEmail)
    if (existing) return jsonRes({ error: 'This email is already an admin user.' }, 409)

    const newAdmin: OrgAdmin = {
      email: inviteEmail,
      name: inviteName,
      role: inviteRole,
      status: 'invited',
      invitedAt: Date.now(),
      invitedBy: email,
    }
    admins.push(newAdmin)
    await saveOrgAdmins(orgSlug, admins)

    // Send invite email
    const siteUrl = getEnv('URL') || getEnv('DEPLOY_PRIME_URL') || ''
    const acceptUrl = `${siteUrl}/admin?invite=${encodeURIComponent(orgSlug)}&email=${encodeURIComponent(inviteEmail)}`
    await sendInviteEmail({
      to: inviteEmail,
      orgName: orgConfig.orgName,
      inviterName: '',
      inviterEmail: email,
      role: inviteRole,
      personalMessage,
      acceptUrl,
    })

    await writeEnterpriseAudit(orgSlug, {
      action: 'admin_invited',
      email,
      target: inviteEmail,
      role: inviteRole,
    })

    return jsonRes({ ok: true, admin: newAdmin })
  }

  // ── PATCH: update role / status ────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (role !== 'manager' && role !== 'owner') {
      return jsonRes({ error: 'Manager or Owner required.' }, 403)
    }
    if (!targetEmail) return jsonRes({ error: 'email param required.' }, 400)

    const admins = await loadOrgAdmins(orgSlug)
    const idx = admins.findIndex(a => a.email === targetEmail)
    if (idx === -1) return jsonRes({ error: 'Admin not found.' }, 404)

    const body = await readBody(req)
    const newRole = String(body.role || admins[idx].role).trim().toLowerCase() as EnterpriseRole
    const newStatus = String(body.status || admins[idx].status).trim().toLowerCase()
    const newName = String(body.name || admins[idx].name).trim()

    // Only owners can promote to owner or modify owners
    if ((newRole === 'owner' || admins[idx].role === 'owner') && role !== 'owner') {
      return jsonRes({ error: 'Only Owners can modify Owner accounts.' }, 403)
    }
    if (!VALID_ROLES.includes(newRole)) return jsonRes({ error: 'Invalid role.' }, 400)
    if (!['active', 'suspended', 'invited'].includes(newStatus)) return jsonRes({ error: 'Invalid status.' }, 400)

    // Cannot remove the last owner
    if (admins[idx].role === 'owner' && newRole !== 'owner') {
      const ownerCount = admins.filter(a => a.role === 'owner' && a.status === 'active').length
      if (ownerCount <= 1) return jsonRes({ error: 'Cannot remove the last Owner. Add another Owner first.' }, 409)
    }

    admins[idx] = { ...admins[idx], role: newRole, status: newStatus as OrgAdmin['status'], name: newName }
    await saveOrgAdmins(orgSlug, admins)

    await writeEnterpriseAudit(orgSlug, {
      action: 'admin_updated',
      email,
      target: targetEmail,
      newRole,
      newStatus,
    })

    return jsonRes({ ok: true, admin: admins[idx] })
  }

  // ── DELETE: remove admin ───────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (role !== 'owner') return jsonRes({ error: 'Only Owners can remove admins.' }, 403)
    if (!targetEmail) return jsonRes({ error: 'email param required.' }, 400)

    const admins = await loadOrgAdmins(orgSlug)
    const idx = admins.findIndex(a => a.email === targetEmail)
    if (idx === -1) return jsonRes({ error: 'Admin not found.' }, 404)

    // Cannot remove self if last owner
    if (admins[idx].role === 'owner') {
      const ownerCount = admins.filter(a => a.role === 'owner' && a.status === 'active').length
      if (ownerCount <= 1) return jsonRes({ error: 'Cannot remove the last Owner.' }, 409)
    }

    const removed = admins.splice(idx, 1)[0]
    await saveOrgAdmins(orgSlug, admins)

    await writeEnterpriseAudit(orgSlug, {
      action: 'admin_removed',
      email,
      target: targetEmail,
      removedRole: removed.role,
    })

    return jsonRes({ ok: true })
  }

  return jsonRes({ error: 'Method not allowed.' }, 405)
}

export const config: Config = {
  path: '/api/enterprise/admins',
  method: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}
