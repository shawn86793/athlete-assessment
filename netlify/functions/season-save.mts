import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUserId } from './_auth.mts'
import { writeAuditLog } from './_admin.mts'

const store = getStore({ name: 'seasons', consistency: 'strong' })

const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  Response.json(body, init)

const seasonsKey = (userId: string) => `users/${userId}/seasons`
const profileKey = (userId: string) => `users/${userId}/profile`

const readObject = async (key: string) => {
  const existing = await store.get(key, { type: 'json' })
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return {}
  return existing as Record<string, unknown>
}

const readSeasonsMap = async (userId: string) =>
  (await readObject(seasonsKey(userId))) as Record<string, Record<string, unknown>>

const readProfile = async (userId: string) =>
  (await readObject(profileKey(userId))) as Record<string, unknown>

const parseBody = async (req: Request) => {
  const raw = await req.text()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export default async (req: Request, context: Context) => {
  try {
    const userId = getUserId(req, context)
    if (!userId) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)

    if (req.method === 'GET') {
      try {
        const map = await readSeasonsMap(userId)
        const includeProfile = url.searchParams.get('profile') === '1'
        const profile = includeProfile ? await readProfile(userId) : null
        const seasonId = String(url.searchParams.get('seasonId') || '').trim()
        const season = seasonId ? map[seasonId] || null : null

        return jsonResponse({
          userId,
          seasons: map,
          season,
          ...(includeProfile ? { profile } : {}),
        })
      } catch (error) {
        console.error('[season-save] GET failed:', error)
        return jsonResponse({ error: 'Failed to load seasons' }, { status: 500 })
      }
    }

    if (req.method === 'DELETE') {
      try {
        const body = await parseBody(req)
        const seasonId =
          String(url.searchParams.get('seasonId') || '').trim() ||
          String(body?.seasonId || '').trim()

        if (!seasonId) {
          return jsonResponse({ error: 'Missing seasonId' }, { status: 400 })
        }

        const map = await readSeasonsMap(userId)
        if (Object.prototype.hasOwnProperty.call(map, seasonId)) {
          delete map[seasonId]
          await store.setJSON(seasonsKey(userId), map)
        }
        await writeAuditLog({
          action: 'season_delete',
          status: 'ok',
          functionName: 'season-save',
          statusCode: 200,
          userId,
          seasonId,
        })

        return jsonResponse({
          ok: true,
          userId,
          seasonId,
          seasonCount: Object.keys(map).length,
          seasons: map,
        })
      } catch (error) {
        console.error('[season-save] DELETE failed:', error)
        await writeAuditLog({
          action: 'season_delete',
          status: 'failed',
          functionName: 'season-save',
          statusCode: 500,
          userId,
          error: error instanceof Error ? error.message : 'Failed to delete season',
        })
        return jsonResponse({ error: 'Failed to delete season' }, { status: 500 })
      }
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
    }

    const body = await parseBody(req)
    if (!body) {
      return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const seasonId = String(body.seasonId || '').trim()
    const season = body.season
    const seasons = body.seasons
    const replaceSeasons = body.replaceSeasons === true
    const profile = body.profile
    const profileReplace = body.profileReplace === true
    const hasProfilePayload = !!profile && typeof profile === 'object' && !Array.isArray(profile)

    if (
      !seasonId &&
      (!seasons || typeof seasons !== 'object' || Array.isArray(seasons)) &&
      !hasProfilePayload
    ) {
      return jsonResponse({ error: 'Missing season payload' }, { status: 400 })
    }

    try {
      let map = await readSeasonsMap(userId)

      if (seasons && typeof seasons === 'object' && !Array.isArray(seasons)) {
        if (replaceSeasons) {
          map = { ...(seasons as Record<string, Record<string, unknown>>) }
        } else {
          Object.assign(map, seasons)
        }
      }

      if (seasonId && season && typeof season === 'object' && !Array.isArray(season)) {
        map[seasonId] = season as Record<string, unknown>
        // Legacy per-season key retained for calendar subscribe compatibility.
        await store.setJSON(seasonId, season)
      }

      await store.setJSON(seasonsKey(userId), map)

      let savedProfile: Record<string, unknown> | null = null
      if (hasProfilePayload) {
        if (profileReplace) {
          savedProfile = { ...(profile as Record<string, unknown>) }
        } else {
          const existingProfile = await readProfile(userId)
          savedProfile = { ...existingProfile, ...(profile as Record<string, unknown>) }
        }
        await store.setJSON(profileKey(userId), savedProfile)
      }

      return jsonResponse({
        ok: true,
        userId,
        seasonCount: Object.keys(map).length,
        seasons: map,
        ...(savedProfile ? { profile: savedProfile } : {}),
      })
    } catch (error) {
      console.error('[season-save] POST failed:', error)
      return jsonResponse({ error: 'Failed to save season' }, { status: 500 })
    }
  } catch (error) {
    console.error('[season-save] Unhandled failure:', error)
    return jsonResponse({ error: 'Internal server error' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/seasons/save',
  method: ['GET', 'POST', 'DELETE'],
}
