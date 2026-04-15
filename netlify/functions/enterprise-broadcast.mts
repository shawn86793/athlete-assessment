import type { Config } from '@netlify/functions'
import { Resend } from 'resend'
import {
  generateId,
  getOrgAssessments,
  getOrgPlayers,
  getOrgTeams,
  jsonRes,
  loadOrgBroadcasts,
  readBody,
  requireEnterpriseAdmin,
  saveOrgBroadcasts,
  writeEnterpriseAudit,
  type BroadcastRecord,
} from './_enterprise.mts'
import { getEnv } from './_admin.mts'

const escapeHtml = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const buildEmailHtml = (subject: string, message: string, orgName: string, ctaLabel?: string, ctaUrl?: string) => {
  const lines = message.split('\n').map(l => `<p style="color:#333;margin:0 0 10px;line-height:1.6;">${escapeHtml(l)}</p>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="background:#0a1e3d;padding:20px 28px;">
  <span style="color:#fff;font-size:18px;font-weight:900;">${escapeHtml(orgName)}</span>
</td></tr>
<tr><td style="padding:28px;">
  <h2 style="margin:0 0 16px;color:#0a1e3d;font-size:20px;">${escapeHtml(subject)}</h2>
  <div>${lines}</div>
  ${ctaUrl && ctaLabel ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(ctaUrl)}" style="background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">${escapeHtml(ctaLabel)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #f1f5f9;">
  <p style="color:#999;font-size:12px;margin:0;">This message was sent by ${escapeHtml(orgName)}.</p>
</td></tr>
</table></td></tr></table></body></html>`
}

const resolveRecipients = async (
  audienceType: string,
  audienceIds: string[],
  customEmails: string[],
  orgMemberUserIds: string[],
) => {
  const emails = new Set<string>()

  if (audienceType === 'custom') {
    for (const e of customEmails) {
      const n = String(e || '').trim().toLowerCase()
      if (n && n.includes('@')) emails.add(n)
    }
    return Array.from(emails)
  }

  const players = await getOrgPlayers(orgMemberUserIds)
  const teams = audienceType === 'teams' || audienceType === 'assessments'
    ? await getOrgTeams(orgMemberUserIds)
    : []

  let targetPlayers = players

  if (audienceType === 'teams' && audienceIds.length) {
    const teamUserIds = new Set<string>()
    for (const t of teams) {
      if (audienceIds.includes(String(t.id || ''))) teamUserIds.add(String(t._userId || ''))
    }
    targetPlayers = players.filter(p => teamUserIds.has(String(p._userId || '')))
  }

  if (audienceType === 'assessments' && audienceIds.length) {
    const assessmentIds = new Set(audienceIds)
    targetPlayers = players.filter(p => assessmentIds.has(String(p._assessmentId || '')))
  }

  for (const p of targetPlayers) {
    const g = String(p.guardianEmail || p.email || '').trim().toLowerCase()
    if (g && g.includes('@')) emails.add(g)
    for (const e of Array.isArray(p.portalInviteEmails) ? p.portalInviteEmails as string[] : []) {
      const n = String(e || '').trim().toLowerCase()
      if (n && n.includes('@')) emails.add(n)
    }
  }

  return Array.from(emails)
}

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })

  const auth = await requireEnterpriseAdmin(req, 'staff')
  if (auth instanceof Response) return auth
  const { orgSlug, email, orgConfig } = auth

  const url = new URL(req.url)

  // ── GET: list broadcast history ─────────────────────────────────────────────
  if (req.method === 'GET') {
    const broadcasts = await loadOrgBroadcasts(orgSlug)
    broadcasts.sort((a, b) => b.sentAt - a.sentAt)
    return jsonRes({ broadcasts, total: broadcasts.length })
  }

  // ── POST: send or save broadcast ────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = await readBody(req)
    const subject = String(body.subject || '').trim()
    const message = String(body.message || '').trim()
    const audienceType = String(body.audienceType || 'all').trim().toLowerCase()
    const audienceIds = Array.isArray(body.audienceIds)
      ? (body.audienceIds as unknown[]).map(v => String(v || '').trim()).filter(Boolean)
      : []
    const customEmails = Array.isArray(body.customEmails)
      ? (body.customEmails as unknown[]).map(v => String(v || '').trim()).filter(Boolean)
      : []
    const ctaLabel = String(body.ctaLabel || '').trim()
    const ctaUrl = String(body.ctaUrl || '').trim()
    const isDraft = body.draft === true

    if (!subject) return jsonRes({ error: 'Subject is required.' }, 400)
    if (!message) return jsonRes({ error: 'Message is required.' }, 400)

    const recipients = await resolveRecipients(audienceType, audienceIds, customEmails, orgConfig.memberUserIds)

    const record: BroadcastRecord = {
      id: generateId('bc'),
      subject,
      body: message,
      audienceType,
      audienceDescription: audienceType === 'custom'
        ? `${customEmails.length} custom addresses`
        : audienceType === 'teams'
          ? `${audienceIds.length} team(s)`
          : audienceType === 'assessments'
            ? `${audienceIds.length} assessment(s)`
            : 'Entire Organization',
      recipientCount: recipients.length,
      sentBy: email,
      sentAt: Date.now(),
      status: isDraft ? 'draft' : 'sent',
    }

    if (!isDraft) {
      const resendKey = getEnv('RESEND_API_KEY')
      if (!resendKey) return jsonRes({ error: 'RESEND_API_KEY not configured.' }, 503)
      const resend = new Resend(resendKey)

      const fromEmail = getEnv('FROM_EMAIL') || 'noreply@swg47.com'
      const fromName = orgConfig.emailFromName || orgConfig.orgName || 'Tryout'
      const html = buildEmailHtml(subject, message, orgConfig.orgName, ctaLabel || undefined, ctaUrl || undefined)

      let sentCount = 0
      let failCount = 0

      // Send in batches of 50 to avoid rate limits
      for (let i = 0; i < recipients.length; i += 50) {
        const batch = recipients.slice(i, i + 50)
        try {
          const result = await resend.emails.send({
            from: `${fromName} <${fromEmail}>`,
            to: batch,
            subject,
            html,
            text: message,
            reply_to: orgConfig.emailReplyTo || fromEmail,
          })
          if (result.error) failCount += batch.length
          else sentCount += batch.length
        } catch {
          failCount += batch.length
        }
      }

      record.recipientCount = sentCount
    }

    const broadcasts = await loadOrgBroadcasts(orgSlug)
    broadcasts.push(record)
    await saveOrgBroadcasts(orgSlug, broadcasts)

    await writeEnterpriseAudit(orgSlug, {
      action: isDraft ? 'broadcast_saved_draft' : 'broadcast_sent',
      email,
      broadcastId: record.id,
      subject,
      audienceType,
      recipientCount: record.recipientCount,
    })

    return jsonRes({ ok: true, broadcast: record })
  }

  // ── GET recipients preview ──────────────────────────────────────────────────
  if (req.method === 'PUT') {
    const body = await readBody(req)
    const audienceType = String(body.audienceType || 'all').trim().toLowerCase()
    const audienceIds = Array.isArray(body.audienceIds)
      ? (body.audienceIds as unknown[]).map(v => String(v || '').trim()).filter(Boolean)
      : []
    const customEmails = Array.isArray(body.customEmails)
      ? (body.customEmails as unknown[]).map(v => String(v || '').trim()).filter(Boolean)
      : []
    const recipients = await resolveRecipients(audienceType, audienceIds, customEmails, orgConfig.memberUserIds)
    return jsonRes({ recipientCount: recipients.length, recipientPreview: recipients.slice(0, 10) })
  }

  return jsonRes({ error: 'Method not allowed.' }, 405)
}

export const config: Config = {
  path: '/api/enterprise/broadcast',
  method: ['GET', 'POST', 'PUT', 'OPTIONS'],
}
