import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  Response.json(body, init)

let _store: ReturnType<typeof getStore> | null = null
const cloudStore = () => {
  if (!_store) _store = getStore({ name: 'cloud-tryouts', consistency: 'strong' })
  return _store
}
const MAX_WRITE_RETRIES = 6

const isBlobsNotConfigured = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes('netlify blobs')
}

const coerceUpdatedAt = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const normalizePlayerId = (value: unknown) => String(value || '').trim()

const isQrRegistration = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase() === 'qr'

const mergeRosterRegistrations = (
  incomingTryout: Record<string, unknown>,
  existingTryout: Record<string, unknown> | null
) => {
  if (!existingTryout) return incomingTryout
  const incomingRoster = Array.isArray(incomingTryout.roster) ? incomingTryout.roster : []
  const existingRoster = Array.isArray(existingTryout.roster) ? existingTryout.roster : []
  if (!existingRoster.length) return incomingTryout

  const incomingUpdatedAt = coerceUpdatedAt(incomingTryout.updatedAt)
  const incomingPlayerIds = new Set(
    incomingRoster.map((player) => normalizePlayerId((player as Record<string, unknown>)?.id)).filter(Boolean)
  )

  const additions: Record<string, unknown>[] = []
  for (const player of existingRoster) {
    if (!player || typeof player !== 'object') continue
    const existingPlayer = player as Record<string, unknown>
    const playerId = normalizePlayerId(existingPlayer.id)
    if (!playerId || incomingPlayerIds.has(playerId)) continue

    const createdAt = coerceUpdatedAt(existingPlayer.createdAt)
    const preservePlayer = isQrRegistration(existingPlayer.registrationSource) || createdAt > incomingUpdatedAt
    if (!preservePlayer) continue

    additions.push(existingPlayer)
    incomingPlayerIds.add(playerId)
  }

  if (!additions.length) return incomingTryout

  return {
    ...incomingTryout,
    roster: [...incomingRoster, ...additions],
    updatedAt: Math.max(incomingUpdatedAt, coerceUpdatedAt(existingTryout.updatedAt)),
  }
}

const normalizeTryout = (value: unknown, cloudId: string) => {
  if (!value || typeof value !== 'object') return null
  const payload = { ...(value as Record<string, unknown>) }
  payload.id = payload.id || cloudId
  if (!coerceUpdatedAt(payload.updatedAt)) {
    payload.updatedAt = Date.now()
  }
  payload.cloud = { ...(payload.cloud as Record<string, unknown>), id: cloudId, enabled: true }
  return payload
}

const writeTryoutWithRetry = async (cloudId: string, incomingTryout: Record<string, unknown>) => {
  for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt += 1) {
    let existingEntry: { data: unknown; etag?: string } | null = null
    try {
      existingEntry = await cloudStore().getWithMetadata(cloudId, { type: 'json' })
    } catch {
      if (attempt < MAX_WRITE_RETRIES - 1) continue
      return false
    }

    const existingTryout =
      existingEntry?.data && typeof existingEntry.data === 'object'
        ? (existingEntry.data as Record<string, unknown>)
        : null
    const mergedPayload = mergeRosterRegistrations(incomingTryout, existingTryout)

    const body = JSON.stringify(mergedPayload)
    const opts = { metadata: { contentType: 'application/json' } }
    try {
      if (existingEntry) {
        if (existingEntry.etag) {
          // Conditional write using ETag for optimistic concurrency
          const result = await cloudStore().set(cloudId, body, { ...opts, onlyIfMatch: existingEntry.etag })
          if (result && result.modified === false) {
            // ETag mismatch — another write happened; retry with fresh read
            continue
          }
        } else {
          // Existing entry but no ETag — unconditional write (returns void)
          await cloudStore().set(cloudId, body, opts)
        }
      } else {
        // No existing entry — create new with onlyIfNew guard
        const result = await cloudStore().set(cloudId, body, { ...opts, onlyIfNew: true })
        if (result && result.modified === false) {
          // Another write created the entry first; retry to merge
          continue
        }
      }
      // Write succeeded
      return true
    } catch {
      if (attempt >= MAX_WRITE_RETRIES - 1) return false
    }
  }

  return false
}

export default async (req: Request, context: Context) => {
  const cloudId = context.params?.id
  if (!cloudId) {
    return jsonResponse({ error: 'Cloud id required.' }, { status: 400 })
  }

  if (req.method === 'GET') {
    try {
      const tryout = await cloudStore().get(cloudId, { type: 'json' })
      if (!tryout) {
        return jsonResponse({ error: 'Not found.' }, { status: 404 })
      }
      return jsonResponse({ tryout })
    } catch (error) {
      if (isBlobsNotConfigured(error)) {
        return jsonResponse(
          { error: 'Cloud storage not configured.', notConfigured: true },
          { status: 503 }
        )
      }
      return jsonResponse({ error: 'Cloud storage error.' }, { status: 500 })
    }
  }

  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null)
    const tryout = body?.tryout
    if (!tryout || typeof tryout !== 'object') {
      return jsonResponse({ error: 'Invalid payload.' }, { status: 400 })
    }

    const payload = normalizeTryout(tryout, cloudId)
    if (!payload) {
      return jsonResponse({ error: 'Invalid payload.' }, { status: 400 })
    }

    try {
      const wrote = await writeTryoutWithRetry(cloudId, payload)
      if (!wrote) {
        return jsonResponse({ error: 'Cloud update conflict. Please retry.' }, { status: 409 })
      }
    } catch (error) {
      if (isBlobsNotConfigured(error)) {
        return jsonResponse(
          { error: 'Cloud storage not configured.', notConfigured: true },
          { status: 503 }
        )
      }
      return jsonResponse({ error: 'Cloud storage error.' }, { status: 500 })
    }

    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
}

export const config: Config = {
  path: '/api/cloud/:id',
  method: ['GET', 'PUT'],
}
