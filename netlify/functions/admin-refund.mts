import type { Config } from '@netlify/functions'
import { getEnv, jsonResponse, readJsonBody, requireSuperAdminOr401, writeAuditLog } from './_admin.mts'

const stripeRequest = async (path: string, init: RequestInit = {}) => {
  const secret = getEnv('STRIPE_SECRET_KEY')
  if (!secret) {
    throw new Error('Stripe is not configured.')
  }

  const headers = new Headers(init.headers || {})
  headers.set('Authorization', `Bearer ${secret}`)
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
  }

  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    ...init,
    headers,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = String((data as { error?: { message?: string } })?.error?.message || 'Stripe request failed.')
    throw new Error(message)
  }

  return data as Record<string, unknown>
}

const toCents = (amount: unknown) => {
  const num = Number(amount)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.round(num * 100)
}

export default async (req: Request) => {
  const auth = requireSuperAdminOr401(req)
  if (auth instanceof Response) return auth

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const body = await readJsonBody(req)
  const customerId = String(body?.customerId || '').trim()
  const chargeIdInput = String(body?.chargeId || body?.paymentId || '').trim()
  const paymentIntentId = String(body?.paymentIntentId || '').trim()
  const note = String(body?.note || body?.reason || '').trim()
  const amountCents = toCents(body?.amount)

  if (!customerId) {
    return jsonResponse({ error: 'customerId is required.' }, { status: 400 })
  }
  if (!note) {
    return jsonResponse({ error: 'A refund reason note is required.' }, { status: 400 })
  }

  try {
    let chargeId = chargeIdInput

    if (!chargeId && paymentIntentId) {
      const pi = await stripeRequest(`/payment_intents/${encodeURIComponent(paymentIntentId)}`)
      const latestCharge = String(pi.latest_charge || '').trim()
      if (latestCharge) chargeId = latestCharge
    }

    if (!chargeId) {
      const params = new URLSearchParams()
      params.set('customer', customerId)
      params.set('limit', '1')
      const charges = await stripeRequest(`/charges?${params.toString()}`)
      const first = Array.isArray(charges.data) && charges.data[0] ? (charges.data[0] as Record<string, unknown>) : null
      chargeId = String(first?.id || '').trim()
    }

    if (!chargeId) {
      return jsonResponse({ error: 'No refundable Stripe charge found for this customer.' }, { status: 404 })
    }

    const form = new URLSearchParams()
    form.set('charge', chargeId)
    if (amountCents) form.set('amount', String(amountCents))
    form.set('reason', 'requested_by_customer')
    form.set('metadata[admin_note]', note)
    form.set('metadata[admin_email]', auth.email)

    const refund = await stripeRequest('/refunds', {
      method: 'POST',
      body: form.toString(),
    })

    await writeAuditLog({
      action: 'refund',
      status: 'ok',
      adminEmail: auth.email,
      customerId,
      chargeId,
      amountCents: amountCents || 'full',
      note,
      refundId: refund.id,
    })

    return jsonResponse({ ok: true, refund })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Refund failed.'
    await writeAuditLog({
      action: 'refund',
      status: 'failed',
      adminEmail: auth.email,
      customerId,
      note,
      error: message,
    })
    return jsonResponse({ error: message }, { status: 502 })
  }
}

export const config: Config = {
  path: '/api/admin/refund',
  method: 'POST',
}
