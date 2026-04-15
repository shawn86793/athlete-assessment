import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUserId } from './_auth.mts'
import { writeAuditLog } from './_admin.mts'

const store = getStore({ name: 'seasons', consistency: 'strong' })
const seasonsKey = (userId: string) => `users/${userId}/seasons`

type RecordMap = Record<string, unknown>

type InviteRequest = {
  playerId: string
  email: string
  recipientType: 'guardian' | 'family' | 'player'
}

const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  Response.json(body, init)

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase()

const isObject = (value: unknown): value is RecordMap =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isValidEmail = (value: string) => /.+@.+\..+/.test(value)

const escapeHTML = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const base64UrlEncodeJson = (payload: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(payload), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const ensurePlayerSecret = (player: RecordMap) => {
  const existing = String(player.guardianToken || '').trim()
  if (existing) return existing
  const secret = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  player.guardianToken = secret
  return secret
}

const toPlayerName = (player: RecordMap) => {
  const first = String(player.firstName || '').trim()
  const last = String(player.lastName || '').trim()
  return `${first} ${last}`.trim() || String(player.name || 'Player').trim() || 'Player'
}

const toPlayerFirstName = (player: RecordMap) =>
  String(player.firstName || '').trim() || toPlayerName(player).split(/\s+/).filter(Boolean)[0] || 'Player'

const getBaseUrl = (req: Request) => {
  const reqUrl = new URL(req.url)
  if (reqUrl.origin) return reqUrl.origin
  return 'https://tryout-aas.netlify.app'
}

const sendEmail = async (args: {
  to: string
  subject: string
  html: string
  text: string
  fromEmail: string
  fromName: string
}) => {
  const sendgridKey = Netlify.env.get('SENDGRID_API_KEY') || ''
  const resendKey = Netlify.env.get('RESEND_API_KEY') || ''

  if (sendgridKey) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendgridKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: args.to }] }],
        from: { email: args.fromEmail, name: args.fromName },
        subject: args.subject,
        content: [
          { type: 'text/plain', value: args.text },
          { type: 'text/html', value: args.html },
        ],
      }),
    })
    return res.ok || res.status === 202
  }

  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${args.fromName} <${args.fromEmail}>`,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    })
    return res.ok
  }

  return false
}

const hasEmailProvider = () => {
  const sendgridKey = Netlify.env.get('SENDGRID_API_KEY') || ''
  const resendKey = Netlify.env.get('RESEND_API_KEY') || ''
  return !!(String(sendgridKey).trim() || String(resendKey).trim())
}

const buildInviteEmail = (args: {
  teamName: string
  playerName: string
  playerFirstName: string
  seasonYear: string
  sport: string
  portalUrl: string
  recipientType: 'guardian' | 'family' | 'player'
}) => {
  const subject = `Your portal for ${args.playerName} — ${args.teamName}`
  const opener =
    args.recipientType === 'player'
      ? `Hi ${args.playerFirstName},`
      : `Hi ${args.recipientType === 'family' ? 'there' : 'Guardian'},`
  const explainer =
    args.recipientType === 'player'
      ? 'Use this link to view your team schedule and confirm your own attendance.'
      : 'Use this link to view the schedule and confirm attendance for upcoming events.'

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f3f7ff;">
  <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
    <div style="background:#ffffff;border:1px solid #d9e6ea;border-radius:12px;padding:22px;">
      <h1 style="margin:0 0 8px;color:#0b2946;font-size:22px;">${escapeHTML(args.teamName)} Portal</h1>
      <p style="margin:0 0 14px;color:#4b5f70;font-size:14px;">${escapeHTML(args.seasonYear)} ${escapeHTML(args.sport)} • ${escapeHTML(args.playerName)}</p>
      <p style="margin:0 0 10px;color:#0f2940;font-size:15px;">${escapeHTML(opener)}</p>
      <p style="margin:0 0 16px;color:#0f2940;font-size:15px;">${escapeHTML(explainer)}</p>
      <div style="margin:18px 0; text-align:center;">
        <a href="${escapeHTML(args.portalUrl)}" style="display:inline-block;background:#0057B8;color:#ffffff;text-decoration:none;font-weight:800;padding:12px 22px;border-radius:10px;">Open My Portal</a>
      </div>
      <div style="border:1px solid #e5edf5;border-radius:10px;padding:12px;background:#f8fbff;">
        <div style="font-weight:800;color:#17324a;margin-bottom:8px;">Add the team calendar</div>
        <div style="font-size:13px;color:#3d5567;line-height:1.55;">
          <b>iPhone (Apple Calendar)</b><br>
          1. Tap Open My Portal.<br>
          2. Tap Add to Apple Calendar.<br>
          3. Open the downloaded .ics file and tap Add All.<br><br>
          <b>Android (Google Calendar)</b><br>
          1. Tap Open My Portal.<br>
          2. Tap Add to Google Calendar.<br>
          3. Confirm the subscription in Google Calendar.
        </div>
      </div>
    </div>
  </div>
</body>
</html>`

  const text = `${args.teamName} Portal

${opener}

${explainer}

Team: ${args.teamName}
Player: ${args.playerName}
Season: ${args.seasonYear}
Sport: ${args.sport}

Open My Portal: ${args.portalUrl}

Add the team calendar

iPhone (Apple Calendar)
1. Tap Open My Portal.
2. Tap Add to Apple Calendar.
3. Open the downloaded .ics file and tap Add All.

Android (Google Calendar)
1. Tap Open My Portal.
2. Tap Add to Google Calendar.
3. Confirm the subscription in Google Calendar.
`

  return { subject, html, text }
}

const ensurePlayerInviteFields = (player: RecordMap) => {
  const emails = Array.isArray(player.portalInviteEmails) ? player.portalInviteEmails : []
  player.portalInviteEmails = Array.from(
    new Set(emails.map((email) => normalizeEmail(email)).filter(Boolean))
  )
  if (!isObject(player.portalInviteEmailSentAt)) {
    player.portalInviteEmailSentAt = {}
  }
}

const loadSeason = async (userId: string, seasonId: string) => {
  const seasons = await store.get(seasonsKey(userId), { type: 'json' })
  if (!isObject(seasons)) return null
  const season = seasons[seasonId]
  if (!isObject(season)) return null
  return { seasons, season }
}

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const userId = getUserId(req, context)
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const seasonId = String(body?.seasonId || '').trim()
  const force = Boolean(body?.force)
  const invites = Array.isArray(body?.invites) ? (body.invites as InviteRequest[]) : []
  if (!seasonId || invites.length === 0) {
    return jsonResponse({ error: 'Missing seasonId or invites.' }, { status: 400 })
  }

  const loaded = await loadSeason(userId, seasonId)
  if (!loaded) {
    return jsonResponse({ error: 'Season not found.' }, { status: 404 })
  }

  if (!hasEmailProvider()) {
    await writeAuditLog({
      action: 'portal_invite_send',
      status: 'failed',
      functionName: 'portal-invites',
      statusCode: 503,
      userId,
      seasonId,
      error: 'No email provider configured.',
    })
    return jsonResponse(
      {
        error: 'Email provider not configured. Add SENDGRID_API_KEY or RESEND_API_KEY in Netlify environment variables.',
      },
      { status: 503 }
    )
  }

  const season = loaded.season
  const roster = Array.isArray(season.roster) ? (season.roster as RecordMap[]) : []
  season.roster = roster

  const teamName = String(season.teamName || season.name || 'Team').trim() || 'Team'
  const seasonYear = String(season.year || '').trim()
  const sport = String(season.sport || '').trim()
  const fromEmail = Netlify.env.get('REGISTRATION_EMAIL_FROM') || 'noreply@athleteassessmentsystems.com'
  const fromName = Netlify.env.get('REGISTRATION_EMAIL_FROM_NAME') || 'Athlete Assessment Systems'
  const baseUrl = getBaseUrl(req)

  let sentCount = 0
  let skippedCount = 0
  let changed = false
  const seen = new Set<string>()

  for (const invite of invites) {
    const playerId = String(invite?.playerId || '').trim()
    const email = normalizeEmail(invite?.email)
    const recipientType =
      String(invite?.recipientType || '').trim().toLowerCase() === 'player'
        ? 'player'
        : String(invite?.recipientType || '').trim().toLowerCase() === 'family'
          ? 'family'
          : 'guardian'

    if (!playerId || !email || !isValidEmail(email)) {
      skippedCount += 1
      continue
    }

    const dedupeKey = `${playerId}|${email}`
    if (seen.has(dedupeKey)) {
      skippedCount += 1
      continue
    }
    seen.add(dedupeKey)

    const player = roster.find((entry) => String(entry?.id || '').trim() === playerId)
    if (!player || !isObject(player)) {
      skippedCount += 1
      continue
    }

    ensurePlayerInviteFields(player)
    const invitedEmails = new Set((player.portalInviteEmails as unknown[]).map(normalizeEmail))
    if (invitedEmails.has(email) && !force) {
      skippedCount += 1
      continue
    }

    const secret = ensurePlayerSecret(player)
    const token = base64UrlEncodeJson({ p: playerId, s: seasonId, k: secret })
    const portalUrl = `${baseUrl}/?availability=${encodeURIComponent(token)}`
    const playerName = toPlayerName(player)
    const playerFirstName = toPlayerFirstName(player)

    const emailContent = buildInviteEmail({
      teamName,
      playerName,
      playerFirstName,
      seasonYear,
      sport,
      portalUrl,
      recipientType,
    })

    const sent = await sendEmail({
      to: email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      fromEmail,
      fromName,
    })

    if (!sent) {
      skippedCount += 1
      continue
    }

    const now = Date.now()
    sentCount += 1
    changed = true
    invitedEmails.add(email)
    player.portalInviteEmails = Array.from(invitedEmails)
    player.portalInviteSentAt = now
    const sentAtMap = player.portalInviteEmailSentAt as RecordMap
    sentAtMap[email] = now
  }

  if (!changed) {
    await writeAuditLog({
      action: 'portal_invite_send',
      status: 'ok',
      functionName: 'portal-invites',
      statusCode: 200,
      userId,
      seasonId,
      sentCount,
      skippedCount,
    })
    return jsonResponse({
      ok: true,
      sentCount,
      skippedCount,
      season,
    })
  }

  season.updatedAt = Date.now()
  loaded.seasons[seasonId] = season

  try {
    await store.setJSON(seasonsKey(userId), loaded.seasons)
    await store.setJSON(seasonId, season)
  } catch {
    await writeAuditLog({
      action: 'portal_invite_send',
      status: 'failed',
      functionName: 'portal-invites',
      statusCode: 500,
      userId,
      seasonId,
      sentCount,
      skippedCount,
      error: 'Failed to save invite status.',
    })
    return jsonResponse({ error: 'Failed to save invite status.' }, { status: 500 })
  }

  await writeAuditLog({
    action: 'portal_invite_send',
    status: 'ok',
    functionName: 'portal-invites',
    statusCode: 200,
    userId,
    seasonId,
    sentCount,
    skippedCount,
  })

  return jsonResponse({
    ok: true,
    sentCount,
    skippedCount,
    season,
  })
}

export const config: Config = {
  path: '/api/portal/invites',
  method: ['POST', 'OPTIONS'],
}
