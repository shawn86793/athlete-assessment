import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUserId } from './_auth.mts'

const store = getStore({ name: 'seasons', consistency: 'strong' })

const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  Response.json(body, init)

const seasonsKey = (userId: string) => `users/${userId}/seasons`

const normalizeSeason = (value: unknown, id: string) => {
  if (!value || typeof value !== 'object') return null
  const payload = { ...(value as Record<string, unknown>), id }
  if (!payload.updatedAt) {
    payload.updatedAt = payload.createdAt || Date.now()
  }
  return payload
}

const seasonUpdatedAt = (season: Record<string, unknown> | null) => {
  if (!season) return 0
  const updated = Number(season.updatedAt || season.createdAt || 0)
  return Number.isFinite(updated) ? updated : 0
}

const loadSeasons = async (userId: string) => {
  const existing = await store.get(seasonsKey(userId), { type: 'json' })
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return {}
  return existing as Record<string, Record<string, unknown>>
}

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const userId = getUserId(req, context)
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const incomingSeasons = body?.seasons
  if (!incomingSeasons || typeof incomingSeasons !== 'object') {
    return jsonResponse({ error: 'Invalid payload.' }, { status: 400 })
  }

  const merged: Record<string, Record<string, unknown>> = {}
  const incoming = incomingSeasons as Record<string, unknown>
  const existing = await loadSeasons(userId)
  const ids = new Set([...Object.keys(existing), ...Object.keys(incoming)])
  for (const id of ids) {
    const local = normalizeSeason(incoming[id], id)
    const remote = normalizeSeason(existing[id], id)
    if (!local && !remote) continue
    if (!local) {
      merged[id] = remote as Record<string, unknown>
      continue
    }
    if (!remote) {
      merged[id] = local
      continue
    }
    merged[id] = seasonUpdatedAt(local) >= seasonUpdatedAt(remote) ? local : remote
  }

  try {
    await store.setJSON(seasonsKey(userId), merged)
  } catch {
    return jsonResponse({ error: 'Failed to save seasons.' }, { status: 500 })
  }

  return jsonResponse({ seasons: merged })
}

export const config: Config = {
  path: '/api/db/seasons-sync',
  method: 'POST',
}
