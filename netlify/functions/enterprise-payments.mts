import type { Config } from '@netlify/functions'
import {
  generateId,
  jsonRes,
  loadOrgPayments,
  readBody,
  requireEnterpriseAdmin,
  saveOrgPayments,
  writeEnterpriseAudit,
  type PaymentRecord,
} from './_enterprise.mts'

const VALID_METHODS = ['cash', 'interac', 'credit_card', 'cheque', 'stripe', 'other']
const VALID_STATUSES = ['paid', 'pending', 'refunded', 'voided', 'complimentary']

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })

  const auth = await requireEnterpriseAdmin(req)
  if (auth instanceof Response) return auth
  const { orgSlug, email, role } = auth

  const url = new URL(req.url)

  // ── GET: list payments ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const payments = await loadOrgPayments(orgSlug)
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase()
    const status = String(url.searchParams.get('status') || '').trim().toLowerCase()
    const method = String(url.searchParams.get('method') || '').trim().toLowerCase()
    const fromDate = url.searchParams.get('from')
    const toDate = url.searchParams.get('to')
    const fromMs = fromDate ? Date.parse(fromDate) : 0
    const toMs = toDate ? Date.parse(toDate) : Infinity

    let filtered = payments
    if (q) {
      filtered = filtered.filter(p =>
        p.playerName.toLowerCase().includes(q) ||
        p.assessmentName.toLowerCase().includes(q) ||
        p.reference.toLowerCase().includes(q) ||
        p.feeName.toLowerCase().includes(q)
      )
    }
    if (status) filtered = filtered.filter(p => p.status === status)
    if (method) filtered = filtered.filter(p => p.method === method)
    if (fromMs) filtered = filtered.filter(p => p.createdAt >= fromMs)
    if (Number.isFinite(toMs)) filtered = filtered.filter(p => p.createdAt <= toMs)

    filtered.sort((a, b) => b.createdAt - a.createdAt)

    // Summary totals
    const totalCollected = filtered
      .filter(p => p.status === 'paid' || p.status === 'complimentary')
      .reduce((s, p) => s + Number(p.amount || 0), 0)
    const totalOutstanding = filtered
      .filter(p => p.status === 'pending')
      .reduce((s, p) => s + Number(p.amount || 0), 0)
    const totalRefunded = filtered
      .filter(p => p.status === 'refunded')
      .reduce((s, p) => s + Number(p.amount || 0), 0)

    // Staff can see status but not amounts — apply masking per role
    const canSeeAmounts = role === 'manager' || role === 'owner'
    const masked = canSeeAmounts
      ? filtered
      : filtered.map(p => ({ ...p, amount: null, reference: '***' }))

    return jsonRes({
      payments: masked,
      total: filtered.length,
      summary: canSeeAmounts
        ? {
            totalCollected: Number(totalCollected.toFixed(2)),
            totalOutstanding: Number(totalOutstanding.toFixed(2)),
            totalRefunded: Number(totalRefunded.toFixed(2)),
            currency: auth.orgConfig.currency,
          }
        : null,
    })
  }

  // ── POST: record new payment ────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (role === 'viewer') return jsonRes({ error: 'Viewer cannot record payments.' }, 403)

    const body = await readBody(req)
    const playerName = String(body.playerName || '').trim()
    const assessmentName = String(body.assessmentName || '').trim()
    const feeName = String(body.feeName || 'Registration Fee').trim()
    const amount = Number(body.amount || 0)
    const method = String(body.method || 'other').trim().toLowerCase()
    const status = String(body.status || 'paid').trim().toLowerCase()
    const reference = String(body.reference || '').trim()
    const notes = String(body.notes || '').trim()
    const receivedAt = Number(body.receivedAt || Date.now())

    if (!playerName) return jsonRes({ error: 'playerName is required.' }, 400)
    if (!Number.isFinite(amount) || amount < 0) return jsonRes({ error: 'Invalid amount.' }, 400)
    if (!VALID_METHODS.includes(method)) return jsonRes({ error: 'Invalid payment method.' }, 400)
    if (!VALID_STATUSES.includes(status)) return jsonRes({ error: 'Invalid status.' }, 400)

    const newPayment: PaymentRecord = {
      id: generateId('pay'),
      playerName,
      playerUserId: String(body.playerUserId || '').trim(),
      playerId: String(body.playerId || '').trim(),
      assessmentId: String(body.assessmentId || '').trim(),
      assessmentName,
      teamId: String(body.teamId || '').trim(),
      teamName: String(body.teamName || '').trim(),
      feeName,
      amount,
      currency: auth.orgConfig.currency,
      method,
      reference,
      status: status as PaymentRecord['status'],
      notes,
      recordedBy: email,
      receivedAt,
      createdAt: Date.now(),
    }

    const payments = await loadOrgPayments(orgSlug)
    payments.push(newPayment)
    await saveOrgPayments(orgSlug, payments)

    await writeEnterpriseAudit(orgSlug, {
      action: 'payment_recorded',
      email,
      paymentId: newPayment.id,
      playerName,
      amount,
      status,
      method,
    })

    return jsonRes({ ok: true, payment: newPayment })
  }

  // ── PATCH: update payment ───────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (role === 'viewer') return jsonRes({ error: 'Viewer cannot modify payments.' }, 403)

    const id = String(url.searchParams.get('id') || '').trim()
    if (!id) return jsonRes({ error: 'Payment id required.' }, 400)

    const payments = await loadOrgPayments(orgSlug)
    const idx = payments.findIndex(p => p.id === id)
    if (idx === -1) return jsonRes({ error: 'Payment not found.' }, 404)

    const body = await readBody(req)
    const allowed = ['status', 'notes', 'reference', 'amount', 'method', 'feeName', 'receivedAt']
    const original = { ...payments[idx] }

    for (const key of allowed) {
      if (key in body) (payments[idx] as Record<string, unknown>)[key] = body[key]
    }

    // Refunds require manager+
    if (body.status === 'refunded' && role === 'staff') {
      return jsonRes({ error: 'Manager or Owner required to issue refunds.' }, 403)
    }

    await saveOrgPayments(orgSlug, payments)
    await writeEnterpriseAudit(orgSlug, {
      action: 'payment_updated',
      email,
      paymentId: id,
      before: original,
      after: payments[idx],
    })

    return jsonRes({ ok: true, payment: payments[idx] })
  }

  // ── DELETE: void payment ────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (role !== 'manager' && role !== 'owner') {
      return jsonRes({ error: 'Manager or Owner required.' }, 403)
    }

    const id = String(url.searchParams.get('id') || '').trim()
    if (!id) return jsonRes({ error: 'Payment id required.' }, 400)

    const payments = await loadOrgPayments(orgSlug)
    const idx = payments.findIndex(p => p.id === id)
    if (idx === -1) return jsonRes({ error: 'Payment not found.' }, 404)

    const voided = { ...payments[idx], status: 'voided' as const }
    payments[idx] = voided

    await saveOrgPayments(orgSlug, payments)
    await writeEnterpriseAudit(orgSlug, {
      action: 'payment_voided',
      email,
      paymentId: id,
      original: payments[idx],
    })

    return jsonRes({ ok: true })
  }

  return jsonRes({ error: 'Method not allowed.' }, 405)
}

export const config: Config = {
  path: '/api/enterprise/payments',
  method: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}
