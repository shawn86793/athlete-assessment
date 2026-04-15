import type { Config } from '@netlify/functions'
import { ensureSchema, getSqlClient } from './_neon.mts'
import {
  jsonResponse,
  readJsonBody,
  requireSuperAdminOr401,
  seasonStore,
  writeAuditLog,
} from './_admin.mts'

const expectedCode = (teamId: string) => `DELETE-TEAM-${teamId}`

export default async (req: Request) => {
  const auth = requireSuperAdminOr401(req)
  if (auth instanceof Response) return auth

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const body = await readJsonBody(req)
  const userId = String(body?.userId || '').trim()
  const teamId = String(body?.teamId || '').trim()
  const confirmationCode = String(body?.confirmationCode || '').trim()
  const note = String(body?.note || '').trim()

  if (!userId || !teamId || !confirmationCode) {
    return jsonResponse({ error: 'userId, teamId, and confirmationCode are required.' }, { status: 400 })
  }
  if (confirmationCode !== expectedCode(teamId)) {
    return jsonResponse({ error: 'Invalid confirmation code.' }, { status: 400 })
  }

  const seasonsKey = `users/${userId}/seasons`
  const profileKey = `users/${userId}/profile`
  const existingSeasons = await seasonStore.get(seasonsKey, { type: 'json' }).catch(() => null)
  const seasonsMap =
    existingSeasons && typeof existingSeasons === 'object' && !Array.isArray(existingSeasons)
      ? ({ ...(existingSeasons as Record<string, Record<string, unknown>>) } as Record<string, Record<string, unknown>>)
      : {}

  const removedSeasonIds: string[] = []
  for (const [seasonId, season] of Object.entries(seasonsMap)) {
    const row = season && typeof season === 'object' ? (season as Record<string, unknown>) : {}
    const seasonTeamId = String(row.teamId || '').trim()
    if (!seasonTeamId || seasonTeamId !== teamId) continue
    removedSeasonIds.push(seasonId)
    delete seasonsMap[seasonId]
  }
  await seasonStore.setJSON(seasonsKey, seasonsMap).catch(() => undefined)
  await Promise.all(removedSeasonIds.map((seasonId) => seasonStore.delete(seasonId).catch(() => undefined)))

  const existingProfile = await seasonStore.get(profileKey, { type: 'json' }).catch(() => null)
  const profile =
    existingProfile && typeof existingProfile === 'object' && !Array.isArray(existingProfile)
      ? ({ ...(existingProfile as Record<string, unknown>) } as Record<string, unknown>)
      : {}
  const deletedSeasons = Array.isArray(profile.deletedSeasons) ? profile.deletedSeasons : []
  const mergedDeletedSeasons = Array.from(
    new Set([...deletedSeasons.map(id => String(id || '').trim()).filter(Boolean), ...removedSeasonIds])
  )
  profile.deletedSeasons = mergedDeletedSeasons
  await seasonStore.setJSON(profileKey, profile).catch(() => undefined)

  const sql = getSqlClient()
  if (sql) {
    await ensureSchema(sql)
    await sql`
      delete from teams
      where user_id = ${userId} and id = ${teamId}
    `
    for (const seasonId of removedSeasonIds) {
      await sql`
        delete from seasons
        where user_id = ${userId} and id = ${seasonId}
      `
    }
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
  }

  await writeAuditLog({
    action: 'delete_team',
    status: 'ok',
    adminEmail: auth.email,
    userId,
    teamId,
    removedSeasonIds,
    removedDeletedSeasonIds: mergedDeletedSeasons,
    note,
  })

  return jsonResponse({
    ok: true,
    userId,
    teamId,
    removedSeasonIds,
    deletedSeasonIds: mergedDeletedSeasons,
    removedSeasonCount: removedSeasonIds.length,
  })
}

export const config: Config = {
  path: '/api/admin/delete-team',
  method: 'POST',
}
