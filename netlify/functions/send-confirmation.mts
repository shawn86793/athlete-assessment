import type { Config } from '@netlify/functions'
import { createLogger } from './_logger.mts'

const escapeHTML = (v: unknown) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const log = createLogger('send-confirmation')

async function sendEmail(args: {
  to: string
  subject: string
  html: string
  text: string
  fromEmail: string
  fromName: string
}): Promise<boolean> {
  const sendgridKey = Netlify.env.get('SENDGRID_API_KEY') || ''
  const resendKey = Netlify.env.get('RESEND_API_KEY') || ''

  if (sendgridKey) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sendgridKey}`, 'Content-Type': 'application/json' },
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
    } catch (err) {
      log.error('SendGrid error', { error: err instanceof Error ? err.message : String(err) })
      return false
    }
  }

  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${args.fromName} <${args.fromEmail}>`,
          to: [args.to],
          subject: args.subject,
          html: args.html,
          text: args.text,
        }),
      })
      return res.ok
    } catch (err) {
      log.error('Resend error', { error: err instanceof Error ? err.message : String(err) })
      return false
    }
  }

  log.warn('No email provider configured — set SENDGRID_API_KEY or RESEND_API_KEY')
  return false
}

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 })
  }

  const body = await req.json().catch(() => null)
  if (!body || !body.to || !body.playerName || !body.eventName) {
    return Response.json(
      { error: 'Missing required fields: to, playerName, eventName.' },
      { status: 400 }
    )
  }

  const fromEmail = Netlify.env.get('REGISTRATION_EMAIL_FROM') || 'noreply@athleteassessmentsystems.com'
  const fromName = Netlify.env.get('REGISTRATION_EMAIL_FROM_NAME') || 'Athlete Assessment Systems'
  const to = String(body.to).trim()
  const playerName = String(body.playerName).trim()
  const eventName = String(body.eventName).trim()
  const eventType = String(body.eventType || '').trim()
  const eventDate = String(body.eventDate || '').trim()
  const sport = String(body.sport || '').trim()
  const position = String(body.position || '').trim()
  const yearOfBirth = String(body.yearOfBirth || '').trim()
  const currentTeam = String(body.currentTeam || '').trim()
  const guardianName = String(body.guardianName || '').trim()

  const subject = `Registration Confirmed — ${eventName}`

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f3f7ff;">
  <div style="max-width:600px;margin:0 auto;padding:30px 16px;">
    <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #d9e6ea;">
      <h1 style="color:#17324a;font-size:22px;margin:0 0 8px;">Registration Confirmed</h1>
      <p style="color:#5a6f7f;margin:0 0 20px;font-size:15px;">
        ${escapeHTML(eventName)}${eventDate ? ` — ${escapeHTML(eventDate)}` : ''}
      </p>
      <p style="color:#17324a;font-size:15px;margin:0 0 16px;">
        Hi ${escapeHTML(guardianName || 'there')},
      </p>
      <div style="background:#e9fff3;border:1px solid #9ee7be;border-radius:8px;padding:12px;margin:0 0 18px;">
        <strong style="color:#0f5c33;">${escapeHTML(playerName)}</strong>
        <span style="color:#0f5c33;"> has been successfully registered for ${escapeHTML(eventName)}.</span>
      </div>
      <table style="width:100%;font-size:14px;color:#315269;border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-weight:700;">Player</td><td style="padding:6px 0;">${escapeHTML(playerName)}</td></tr>
        ${eventType ? `<tr><td style="padding:6px 0;font-weight:700;">Event Type</td><td style="padding:6px 0;">${escapeHTML(eventType)}</td></tr>` : ''}
        ${eventDate ? `<tr><td style="padding:6px 0;font-weight:700;">Date</td><td style="padding:6px 0;">${escapeHTML(eventDate)}</td></tr>` : ''}
        ${yearOfBirth ? `<tr><td style="padding:6px 0;font-weight:700;">Year of Birth</td><td style="padding:6px 0;">${escapeHTML(yearOfBirth)}</td></tr>` : ''}
        ${sport ? `<tr><td style="padding:6px 0;font-weight:700;">Sport</td><td style="padding:6px 0;">${escapeHTML(sport)}</td></tr>` : ''}
        ${position ? `<tr><td style="padding:6px 0;font-weight:700;">Position</td><td style="padding:6px 0;">${escapeHTML(position)}</td></tr>` : ''}
        ${currentTeam ? `<tr><td style="padding:6px 0;font-weight:700;">Current Team</td><td style="padding:6px 0;">${escapeHTML(currentTeam)}</td></tr>` : ''}
      </table>
      <div style="background:#f8fafc;border-radius:8px;padding:12px;margin:18px 0 0;">
        <p style="margin:0;font-size:13px;color:#64748b;">Authorization has been recorded for this registration.</p>
      </div>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0;" />
      <p style="color:#17324a;font-size:14px;margin:0 0 6px;">
        Thank you for registering. We'll be in touch with further details.
      </p>
      <p style="color:#5a6f7f;font-size:13px;margin:16px 0 0;">${escapeHTML(fromName)}</p>
    </div>
  </div>
</body></html>`

  const text = `Registration Confirmed — ${eventName}

Hi ${guardianName || 'there'},

${playerName} has been successfully registered for ${eventName}.

Player: ${playerName}${eventType ? `\nEvent Type: ${eventType}` : ''}${eventDate ? `\nDate: ${eventDate}` : ''}${yearOfBirth ? `\nYear of Birth: ${yearOfBirth}` : ''}${sport ? `\nSport: ${sport}` : ''}${position ? `\nPosition: ${position}` : ''}${currentTeam ? `\nCurrent Team: ${currentTeam}` : ''}

Authorization has been recorded for this registration.

Thank you for registering. We'll be in touch with further details.

${fromName}`

  try {
    const sent = await sendEmail({ to, subject, html, text, fromEmail, fromName })
    if (sent) return Response.json({ ok: true, sent: true })
    return Response.json(
      { ok: false, sent: false, error: 'No email provider configured.' },
      { status: 503 }
    )
  } catch {
    return Response.json({ ok: false, sent: false, error: 'Email sending failed.' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/register/send-confirmation',
  method: ['POST', 'OPTIONS'],
}
