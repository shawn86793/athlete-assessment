import type { Config } from '@netlify/functions'
import { Resend } from 'resend'
import { hasTemplateType, templateMap } from './email-templates.mts'

type SendEmailBody = {
  type?: unknown
  to?: unknown
  payload?: unknown
}

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const normalizeRecipients = (to: unknown): string[] => {
  if (Array.isArray(to)) {
    return Array.from(
      new Set(
        to
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
      )
    )
  }

  const single = String(to || '').trim()
  return single ? [single] : []
}

const buildFromAddress = () => {
  const fromEmail =
    Netlify.env.get('FROM_EMAIL') ||
    Netlify.env.get('REGISTRATION_EMAIL_FROM') ||
    'noreply@tryout.app'

  const fromName = Netlify.env.get('FROM_NAME') || Netlify.env.get('REGISTRATION_EMAIL_FROM_NAME') || 'Tryout'
  return `${fromName} <${fromEmail}>`
}

const getResendClient = () => {
  const apiKey = Netlify.env.get('RESEND_API_KEY') || ''
  if (!apiKey) return null
  return new Resend(apiKey)
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405)
  }

  const resend = getResendClient()
  if (!resend) {
    return json({ error: 'Missing RESEND_API_KEY environment variable.' }, 503)
  }

  const body = (await req.json().catch(() => null)) as SendEmailBody | null
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid JSON body.' }, 400)
  }

  const type = String(body.type || '').trim()
  const recipients = normalizeRecipients(body.to)
  const payload = body.payload && typeof body.payload === 'object'
    ? (body.payload as Record<string, unknown>)
    : null

  if (!type || !hasTemplateType(type)) {
    return json({ error: 'Invalid or missing email type.' }, 400)
  }

  if (!recipients.length) {
    return json({ error: 'Missing recipient email in `to`.' }, 400)
  }

  if (!payload) {
    return json({ error: 'Missing payload object.' }, 400)
  }

  try {
    const template = templateMap[type](payload)
    const result = await resend.emails.send({
      from: buildFromAddress(),
      to: recipients,
      subject: template.subject,
      html: template.html,
      text: template.text,
    })

    if (result.error) {
      return json({ error: result.error.message || 'Resend request failed.' }, 502)
    }

    return json({ success: true, id: result.data?.id || null }, 200)
  } catch (error) {
    console.error('[send-email] Resend error:', error instanceof Error ? error.message : error)
    return json({ error: 'Email sending failed.' }, 500)
  }
}

export const config: Config = {
  path: '/api/notifications/email',
  method: 'POST',
}
