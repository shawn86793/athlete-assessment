import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const store = getStore({ name: 'seasons', consistency: 'strong' })

const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  Response.json(body, init)

const seasonsKey = (userId: string) => `users/${userId}/seasons`

const decodeToken = (token: string) => {
  try {
    const normalized = token.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const decoded = Buffer.from(padded, 'base64').toString('utf-8')
    const parsed = JSON.parse(decoded)
    if (!parsed || typeof parsed !== 'object') return null
    const userId = String(parsed.u || '').trim()
    const seasonId = String(parsed.s || '').trim()
    const secret = String(parsed.k || '').trim()
    if (!userId || !seasonId || !secret) return null
    return { userId, seasonId, secret }
  } catch {
    return null
  }
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''

  if (!token) {
    return jsonResponse({ error: 'Missing token.' }, { status: 400 })
  }

  const decoded = decodeToken(token)
  if (!decoded) {
    return jsonResponse({ error: 'Invalid token.' }, { status: 400 })
  }

  const { userId, seasonId, secret } = decoded

  let season: Record<string, unknown> | null = null
  try {
    const existing = await store.get(seasonsKey(userId), { type: 'json' })
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      const seasonsMap = existing as Record<string, Record<string, unknown>>
      season = seasonsMap[seasonId] || null
    }
  } catch {
    return jsonResponse({ error: 'Failed to load schedule.' }, { status: 500 })
  }

  if (!season) {
    return jsonResponse({ error: 'Schedule not found.' }, { status: 404 })
  }

  // Validate the share token
  const storedSecret = String(season.scheduleShareToken || '').trim()
  if (!storedSecret || storedSecret !== secret) {
    return jsonResponse({ error: 'Invalid or expired token.' }, { status: 403 })
  }

  // Return only safe public data — no roster, no player names, no scores
  const events = Array.isArray(season.events)
    ? (season.events as Record<string, unknown>[]).map((ev) => ({
        id: ev.id,
        type: ev.type,
        title: ev.title,
        date: ev.date,
        startTime: ev.startTime,
        endTime: ev.endTime,
        location: ev.location,
        notes: ev.notes,
      }))
    : []

  return jsonResponse({
    name: season.name || season.teamName || '',
    teamName: season.teamName || season.name || '',
    sport: season.sport || '',
    year: season.year || '',
    events,
  })
}

export const config: Config = {
  path: '/api/schedule/lookup',
  method: 'GET',
}
