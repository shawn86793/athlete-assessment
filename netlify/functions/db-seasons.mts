import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUserId } from './_auth.mts'
import { ensureSchema, getSqlClient } from './_neon.mts'
import { writeAuditLog } from './_admin.mts'

const store = getStore({ name: 'seasons', consistency: 'strong' })

const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  Response.json(body, init)

const seasonsKey = (userId: string) => `users/${userId}/seasons`

const loadSeasons = async (userId: string) => {
  const existing = await store.get(seasonsKey(userId), { type: 'json' })
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return {}
  return existing as Record<string, Record<string, unknown>>
}

export default async (req: Request, context: Context) => {
  const userId = getUserId(req, context)
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })
  }

  const seasonId = context.params?.id
  if (!seasonId) {
    return jsonResponse({ error: 'Season id required.' }, { status: 400 })
  }

  if (req.method === 'GET') {
    try {
      const seasons = await loadSeasons(userId)
      // When seasonId is a specific id, return only that season for forward compatibility
      // When seasonId is 'all' or '_all', return the full map (bulk pull)
      if (seasonId && seasonId !== 'all' && seasonId !== '_all' && Object.prototype.hasOwnProperty.call(seasons, seasonId)) {
        return jsonResponse({ season: seasons[seasonId], seasons })
      }
      return jsonResponse({ seasons })
    } catch {
      return jsonResponse({ error: 'Failed to load seasons.' }, { status: 500 })
    }
  }

  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null)
    const season = body?.season
    if (!season || typeof season !== 'object') {
      return jsonResponse({ error: 'Invalid payload.' }, { status: 400 })
    }

    try {
      const seasons = await loadSeasons(userId)
      seasons[seasonId] = season as Record<string, unknown>
      await store.setJSON(seasonsKey(userId), seasons)
      // Also write per-season key for calendar subscribe compatibility
      await store.setJSON(seasonId, season)
    } catch {
      return jsonResponse({ error: 'Failed to save season.' }, { status: 500 })
    }

    return jsonResponse({ ok: true })
  }

  if (req.method === 'DELETE') {
    // Declare seasons outside try so it is in scope for the final return
    let seasons: Record<string, Record<string, unknown>> = {}
    try {
      seasons = await loadSeasons(userId)
      const deletedSeason = seasons[seasonId] as Record<string, unknown> | undefined
      const teamId = String(deletedSeason?.teamId || '').trim()
      let removedSeasonIds = 0
      if (Object.prototype.hasOwnProperty.call(seasons, seasonId)) {
        delete seasons[seasonId]
        removedSeasonIds = 1
        await store.setJSON(seasonsKey(userId), seasons)
      }
      await store.delete(seasonId).catch(() => undefined)

      const sql = getSqlClient()
      if (sql) {
        await ensureSchema(sql)
        await sql`
          delete from seasons
          where user_id = ${userId} and id = ${seasonId}
        `
        if (teamId) {
          await sql`
            delete from seasons
            where user_id = ${userId}
              and payload->>'teamId' = ${teamId}
          `
          await sql`
            delete from tryouts
            where user_id = ${userId}
              and payload->>'teamId' = ${teamId}
          `
          const remainingTeamSeasons = await sql<{ total: number }[]>`
            select count(*)::int as total
            from seasons
            where user_id = ${userId}
              and payload->>'teamId' = ${teamId}
          `
          if (Number(remainingTeamSeasons[0]?.total || 0) === 0) {
            await sql`
              delete from teams
              where user_id = ${userId} and id = ${teamId}
            `
          }
        }
      }

      await writeAuditLog({
        action: 'season_delete',
        status: 'ok',
        functionName: 'db-seasons',
        statusCode: 200,
        userId,
        seasonId,
        teamId: teamId || null,
        removedSeasonIds,
      })
    } catch {
      await writeAuditLog({
        action: 'season_delete',
        status: 'failed',
        functionName: 'db-seasons',
        statusCode: 500,
        userId,
        seasonId,
        error: 'Failed to delete season.',
      })
      return jsonResponse({ error: 'Failed to delete season.' }, { status: 500 })
    }

    return jsonResponse({ ok: true, seasons })
  }

  return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
}

export const config: Config = {
  path: '/api/db/seasons/:id',
  method: ['GET', 'PUT', 'DELETE'],
}
