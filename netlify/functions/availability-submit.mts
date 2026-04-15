import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const store = getStore({ name: 'seasons', consistency: 'strong' })
const seasonsKey = (userId: string) => `users/${userId}/seasons`

type RecordMap = Record<string, unknown>

const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  Response.json(body, init)

const decodeGuardianToken = (token: string) => {
  try {
    const normalized = String(token).replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const decoded = Buffer.from(padded, 'base64').toString('utf-8')
    const parsed = JSON.parse(decoded)
    if (!parsed || typeof parsed !== 'object') return null

    const playerId = String((parsed as RecordMap).p || (parsed as RecordMap).playerId || '').trim()
    const seasonId = String((parsed as RecordMap).s || (parsed as RecordMap).seasonId || '').trim()
    const secret = String((parsed as RecordMap).k || (parsed as RecordMap).secret || '').trim()
    if (!playerId || !seasonId || !secret) return null

    return { playerId, seasonId, secret }
  } catch {
    return null
  }
}

const normalizeAvailability = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'yes' || normalized === 'maybe' || normalized === 'no') return normalized
  return ''
}

const isObject = (value: unknown): value is RecordMap =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toPlayerName = (player: RecordMap) => {
  const first = String(player.firstName || '').trim()
  const last = String(player.lastName || '').trim()
  const full = `${first} ${last}`.trim()
  return full || String(player.name || 'Player').trim() || 'Player'
}

const readRequestFields = async (req: Request) => {
  if (req.method === 'GET') {
    const url = new URL(req.url)
    return {
      token: String(url.searchParams.get('availability') || url.searchParams.get('token') || '').trim(),
      eventId: String(url.searchParams.get('event') || '').trim(),
      value: '',
      actor: 'guardian' as 'guardian' | 'coach' | 'player',
    }
  }

  const body = await req.json().catch(() => null)
  const rawActor = String(body?.actor || body?.source || 'guardian').trim().toLowerCase()
  const actor: 'guardian' | 'coach' | 'player' = rawActor === 'coach' ? 'coach' : rawActor === 'player' ? 'player' : 'guardian'
  return {
    token: String(body?.token || body?.guardianToken || body?.availability || '').trim(),
    eventId: String(body?.eventId || body?.event || '').trim(),
    value: normalizeAvailability(body?.value),
    actor,
  }
}

const loadSeasonContext = async (token: string) => {
  const decoded = decodeGuardianToken(token)
  if (!decoded) return { error: 'Invalid token.', status: 400 } as const

  const season = await store.get(decoded.seasonId, { type: 'json' })
  if (!isObject(season)) return { error: 'Season not found.', status: 404 } as const

  const roster = Array.isArray(season.roster) ? (season.roster as RecordMap[]) : []
  const player = roster.find((entry) => String(entry?.id || '').trim() === decoded.playerId)
  if (!player || !isObject(player)) return { error: 'Player not found.', status: 404 } as const

  const storedSecret = String(player.guardianToken || '').trim()
  if (!storedSecret || storedSecret !== decoded.secret) {
    return { error: 'Invalid token.', status: 403 } as const
  }

  return {
    decoded,
    season,
    player,
  } as const
}

export default async (req: Request, _context: Context) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const fields = await readRequestFields(req)
  if (!fields.token) {
    return jsonResponse({ error: 'Missing guardian token.' }, { status: 400 })
  }

  const context = await loadSeasonContext(fields.token)
  if ('error' in context) {
    return jsonResponse({ error: context.error }, { status: context.status })
  }

  const events = Array.isArray(context.season.events) ? (context.season.events as RecordMap[]) : []
  const event = fields.eventId ? events.find((entry) => String(entry?.id || '').trim() === fields.eventId) : null

  if (req.method === 'GET') {
    if (!fields.eventId) {
      const portalEvents = events
        .filter((entry) => isObject(entry) && String(entry.date || '').trim())
        .map((entry) => {
          const availability = isObject(entry.availability) ? entry.availability : {}
          const availabilityMeta = isObject(entry.availabilityMeta) ? entry.availabilityMeta : {}
          const existingMeta = isObject(availabilityMeta[context.decoded.playerId])
            ? (availabilityMeta[context.decoded.playerId] as RecordMap)
            : null
          const existingValue = normalizeAvailability(existingMeta?.value || availability[context.decoded.playerId])
          return {
            id: String(entry.id || '').trim(),
            type: String(entry.type || 'Event').trim(),
            title: String(entry.title || entry.type || 'Event').trim(),
            date: String(entry.date || '').trim(),
            startTime: String(entry.startTime || '').trim(),
            endTime: String(entry.endTime || '').trim(),
            location: String(entry.location || '').trim(),
            availability: {
              value: existingValue,
              meta: {
                value: existingValue,
                lastUpdatedBy: String(existingMeta?.lastUpdatedBy || '').trim(),
                lastUpdatedAt: Number(existingMeta?.lastUpdatedAt || 0),
              },
            },
          }
        })

      const reqUrl = new URL(req.url)
      const subscribeUrl = `${reqUrl.origin}/api/seasons/${encodeURIComponent(context.decoded.seasonId)}/calendar.ics?token=${encodeURIComponent(fields.token)}`
      const playerEmail = String(context.player.playerEmail || '').trim().toLowerCase()
      const guardianEmail = String(context.player.guardianEmail || context.player.email || '').trim().toLowerCase()
      const viewerType = playerEmail && playerEmail === guardianEmail ? 'guardian' : playerEmail ? 'player' : 'guardian'

      return jsonResponse({
        ok: true,
        teamName: String(context.season.teamName || context.season.name || '').trim(),
        seasonName: String(context.season.name || context.season.teamName || '').trim(),
        year: String(context.season.year || '').trim(),
        sport: String(context.season.sport || '').trim(),
        player: {
          id: context.decoded.playerId,
          name: toPlayerName(context.player),
          jersey: String(context.player.jersey || '').trim(),
        },
        events: portalEvents,
        viewerType,
        portalNote:
          viewerType === 'player'
            ? 'Use this link to view your team schedule and confirm your own attendance.'
            : 'Use this link to view the schedule and confirm attendance for upcoming events.',
        calendarSubscribeUrl: subscribeUrl,
      })
    }

    if (!event || !isObject(event)) {
      return jsonResponse({ error: 'Event not found.' }, { status: 404 })
    }
    const availability = isObject(event.availability) ? event.availability : {}
    const availabilityMeta = isObject(event.availabilityMeta) ? event.availabilityMeta : {}
    const existingMeta = isObject(availabilityMeta[context.decoded.playerId])
      ? (availabilityMeta[context.decoded.playerId] as RecordMap)
      : null
    const existingValue = normalizeAvailability(existingMeta?.value || availability[context.decoded.playerId])

    return jsonResponse({
      ok: true,
      teamName: String(context.season.teamName || context.season.name || '').trim(),
      seasonName: String(context.season.name || context.season.teamName || '').trim(),
      player: {
        id: context.decoded.playerId,
        name: toPlayerName(context.player),
      },
      event: {
        id: String(event.id || '').trim(),
        type: String(event.type || 'Event').trim(),
        title: String(event.title || event.type || 'Event').trim(),
        date: String(event.date || '').trim(),
        startTime: String(event.startTime || '').trim(),
        endTime: String(event.endTime || '').trim(),
        location: String(event.location || '').trim(),
      },
      availability: {
        value: existingValue,
        lastUpdatedBy: String(existingMeta?.lastUpdatedBy || '').trim(),
        lastUpdatedAt: Number(existingMeta?.lastUpdatedAt || 0),
      },
    })
  }

  if (!fields.eventId || !event || !isObject(event)) {
    return jsonResponse({ error: 'Event not found.' }, { status: 404 })
  }

  const availability = isObject(event.availability) ? event.availability : {}
  const availabilityMeta = isObject(event.availabilityMeta) ? event.availabilityMeta : {}

  if (!fields.value) {
    return jsonResponse({ error: 'Invalid availability value.' }, { status: 400 })
  }

  const now = Date.now()
  availability[context.decoded.playerId] = fields.value
  availabilityMeta[context.decoded.playerId] = {
    value: fields.value,
    lastUpdatedBy: fields.actor,
    lastUpdatedAt: now,
  }
  event.availability = availability
  event.availabilityMeta = availabilityMeta
  context.season.updatedAt = now

  try {
    await store.setJSON(context.decoded.seasonId, context.season)
    const ownerUserId = String(
      context.season.ownerUserId || context.season.scheduleShareUserId || ''
    ).trim()
    if (ownerUserId) {
      const existingMap = await store.get(seasonsKey(ownerUserId), { type: 'json' })
      const seasonsMap = isObject(existingMap) ? existingMap : {}
      seasonsMap[context.decoded.seasonId] = context.season
      await store.setJSON(seasonsKey(ownerUserId), seasonsMap)
    }
  } catch {
    return jsonResponse({ error: 'Failed to save availability.' }, { status: 500 })
  }

  return jsonResponse({
    ok: true,
    availability: {
      value: fields.value,
      lastUpdatedBy: fields.actor,
      lastUpdatedAt: now,
    },
  })
}

export const config: Config = {
  path: '/api/availability/submit',
  method: ['GET', 'POST'],
}
