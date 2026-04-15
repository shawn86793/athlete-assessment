import type { Config } from '@netlify/functions'

const escapeHTML = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

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

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 })
  }

  const body = await req.json().catch(() => null)
  if (!body || !body.to || !body.playerName || !body.assessmentName) {
    return Response.json({ error: 'Missing required fields: to, playerName, assessmentName.' }, { status: 400 })
  }

  const fromEmail = Netlify.env.get('REGISTRATION_EMAIL_FROM') || 'noreply@athleteassessmentsystems.com'
  const fromName = Netlify.env.get('REGISTRATION_EMAIL_FROM_NAME') || 'Athlete Assessment Systems'
  const to = String(body.to).trim()
  const playerName = String(body.playerName).trim()
  const assessmentName = String(body.assessmentName).trim()
  const code = String(body.code || '').trim()
  const sport = String(body.sport || '').trim()
  const position = String(body.position || '').trim()
  const level = String(body.level || '').trim()
  const guardianName = String(body.guardianName || '').trim()

  const subject = `Registration Confirmed - ${assessmentName}`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f3f7ff;">
  <div style="max-width:600px;margin:0 auto;padding:30px 16px;">
    <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #d9e6ea;">
      <h1 style="color:#17324a;font-size:22px;margin:0 0 8px;">Registration Confirmed</h1>
      <p style="color:#5a6f7f;margin:0 0 20px;font-size:15px;">
        ${escapeHTML(assessmentName)}${code ? ` (${escapeHTML(code)})` : ''}
      </p>
      <div style="background:#e9fff3;border:1px solid #9ee7be;border-radius:8px;padding:12px;margin:0 0 18px;">
        <strong style="color:#0f5c33;">${escapeHTML(playerName)}</strong>
        <span style="color:#0f5c33;"> has been successfully registered.</span>
      </div>
      <table style="width:100%;font-size:14px;color:#315269;border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-weight:700;">Player</td><td style="padding:6px 0;">${escapeHTML(playerName)}</td></tr>
        ${sport ? `<tr><td style="padding:6px 0;font-weight:700;">Sport</td><td style="padding:6px 0;">${escapeHTML(sport)}</td></tr>` : ''}
        ${position ? `<tr><td style="padding:6px 0;font-weight:700;">Position</td><td style="padding:6px 0;">${escapeHTML(position)}</td></tr>` : ''}
        ${level ? `<tr><td style="padding:6px 0;font-weight:700;">Level</td><td style="padding:6px 0;">${escapeHTML(level)}</td></tr>` : ''}
        ${guardianName ? `<tr><td style="padding:6px 0;font-weight:700;">Guardian</td><td style="padding:6px 0;">${escapeHTML(guardianName)}</td></tr>` : ''}
      </table>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0;" />
      <p style="color:#5a6f7f;font-size:13px;margin:0;">
        This is an automated confirmation from Athlete Assessment Systems.
        If you did not register for this assessment, please disregard this email.
      </p>
    </div>
  </div>
</body>
</html>`

  const text = `Registration Confirmed

${playerName} has been successfully registered for ${assessmentName}${code ? ` (${code})` : ''}.

Player: ${playerName}${sport ? `\nSport: ${sport}` : ''}${position ? `\nPosition: ${position}` : ''}${level ? `\nLevel: ${level}` : ''}${guardianName ? `\nGuardian: ${guardianName}` : ''}

This is an automated confirmation from Athlete Assessment Systems.`

  try {
    const sent = await sendEmail({ to, subject, html, text, fromEmail, fromName })
    if (sent) {
      return Response.json({ ok: true, sent: true })
    }
    return Response.json(
      { ok: false, sent: false, error: 'No email provider configured. Set SENDGRID_API_KEY or RESEND_API_KEY environment variable.' },
      { status: 503 }
    )
  } catch {
    return Response.json({ ok: false, sent: false, error: 'Email sending failed.' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/registration/confirm-email',
  method: 'POST',
}
