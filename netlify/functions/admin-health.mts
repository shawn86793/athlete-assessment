import type { Config } from '@netlify/functions'
import { cloudStore, getEnv, jsonResponse, listAuditLogsRange, requireSuperAdminOr401, seasonStore } from './_admin.mts'

const nowMs = () => Date.now()
const DAYS = 24 * 60 * 60 * 1000

const toMs = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value || '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

const pingStore = async (label: string, read: () => Promise<unknown>) => {
  const started = nowMs()
  try {
    await read()
    return { name: label, ok: true, latencyMs: nowMs() - started }
  } catch (error) {
    return {
      name: label,
      ok: false,
      latencyMs: nowMs() - started,
      error: error instanceof Error ? error.message : 'Store unreachable',
    }
  }
}

const pingEndpoint = async (url: string, method = 'GET') => {
  const started = nowMs()
  try {
    const res = await fetch(url, { method, signal: AbortSignal.timeout(8000) })
    return {
      endpoint: url,
      method,
      ok: res.status < 500,
      status: res.status,
      latencyMs: nowMs() - started,
    }
  } catch (error) {
    return {
      endpoint: url,
      method,
      ok: false,
      status: 0,
      latencyMs: nowMs() - started,
      error: error instanceof Error ? error.message : 'Request failed',
    }
  }
}

const loadSendgridDelivery = async () => {
  const key = getEnv('SENDGRID_API_KEY')
  if (!key) {
    return { configured: false, entries: [] as Array<Record<string, unknown>> }
  }
  try {
    const params = new URLSearchParams()
    params.set('limit', '10')
    const res = await fetch(`https://api.sendgrid.com/v3/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      return {
        configured: true,
        entries: [] as Array<Record<string, unknown>>,
        error: `SendGrid API returned ${res.status}.`,
      }
    }
    const payload = (await res.json().catch(() => ({}))) as { messages?: Array<Record<string, unknown>> }
    const entries = (payload.messages || []).slice(0, 10).map((msg) => ({
      to: msg.to_email || msg.to || '',
      from: msg.from_email || msg.from || '',
      status: msg.status || msg.event || 'unknown',
      timestamp: msg.last_event_time || msg.last_event_at || msg.created_at || null,
      subject: msg.subject || '',
    }))
    return { configured: true, entries }
  } catch (error) {
    return {
      configured: true,
      entries: [] as Array<Record<string, unknown>>,
      error: error instanceof Error ? error.message : 'Could not read SendGrid status.',
    }
  }
}

export default async (req: Request) => {
  const auth = requireSuperAdminOr401(req)
  if (auth instanceof Response) return auth

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const now = nowMs()
  const logs24h = await listAuditLogsRange(now - DAYS, now)
  const logs7d = await listAuditLogsRange(now - 7 * DAYS, now)

  const functionErrors = logs24h
    .filter((row) => {
      const statusCode = Number(row.statusCode || 0)
      const status = String(row.status || '').toLowerCase()
      return statusCode >= 400 || status === 'failed'
    })
    .map((row) => ({
      functionName: String(row.functionName || row.action || 'unknown'),
      statusCode: Number(row.statusCode || 500),
      timestamp: row.timestamp || null,
      userId: String(row.userId || row.target || ''),
      error: String(row.error || ''),
    }))
    .slice(0, 50)

  const syncAttempts = logs7d.filter((row) => String(row.action || '') === 'cloud_sync')
  const syncSuccess = syncAttempts.filter((row) => String(row.status || '') === 'ok').length
  const syncRate = syncAttempts.length ? Number(((syncSuccess / syncAttempts.length) * 100).toFixed(2)) : 0

  const seasonDeletes = logs7d.filter((row) => String(row.action || '') === 'season_delete')
  const seasonDeleteSuccess = seasonDeletes.filter((row) => String(row.status || '') === 'ok').length
  const seasonDeleteRate = seasonDeletes.length
    ? Number(((seasonDeleteSuccess / seasonDeletes.length) * 100).toFixed(2))
    : 0

  const blobChecks = await Promise.all([
    pingStore('seasons', () => seasonStore.get('health/ping', { type: 'text' })),
    pingStore('cloud-tryouts', () => cloudStore.get('health/ping', { type: 'text' })),
  ])

  const origin = new URL(req.url).origin
  const endpointChecks = await Promise.all([
    pingEndpoint(`${origin}/api/register/event-info`),
    pingEndpoint(`${origin}/api/registration/confirm-email`, 'POST'),
    pingEndpoint(`${origin}/api/portal/invites`, 'OPTIONS'),
  ])

  const sendgrid = await loadSendgridDelivery()

  return jsonResponse({
    checkedAt: new Date(now).toISOString(),
    netlifyBlobs: {
      ok: blobChecks.every((entry) => entry.ok),
      stores: blobChecks,
    },
    recentFunctionErrors: functionErrors,
    cloudSyncHealth: {
      attempts: syncAttempts.length,
      successes: syncSuccess,
      failures: syncAttempts.length - syncSuccess,
      successRate: syncRate,
      lastSuccessAt:
        syncAttempts
          .filter((row) => String(row.status || '') === 'ok')
          .sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))[0]?.timestamp || null,
    },
    seasonDeleteHealth: {
      attempts: seasonDeletes.length,
      successes: seasonDeleteSuccess,
      failures: seasonDeletes.length - seasonDeleteSuccess,
      successRate: seasonDeleteRate,
    },
    registrationPipeline: {
      ok: endpointChecks.every((entry) => entry.ok),
      checks: endpointChecks,
    },
    emailDelivery: sendgrid,
  })
}

export const config: Config = {
  path: '/api/admin/health',
  method: 'GET',
}

