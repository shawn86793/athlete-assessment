import type { Config, Context } from '@netlify/functions'
import { getUserId } from './_auth.mts'
import { ensureSchema, getSqlClient, type SqlClient } from './_neon.mts'
import { writeAuditLog } from './_admin.mts'

const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  Response.json(body, init)

const coerceUpdatedAt = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const normalizeTryout = (value: unknown, id: string) => {
  if (!value || typeof value !== 'object') return null
  const payload = { ...(value as Record<string, unknown>), id }
  if (!coerceUpdatedAt(payload.updatedAt)) {
    payload.updatedAt = Date.now()
  }
  return payload
}

const normalizeTeam = (value: unknown, id: string) => {
  if (!value || typeof value !== 'object') return null
  const payload = { ...(value as Record<string, unknown>), id }
  if (!payload.createdAt) {
    payload.createdAt = Date.now()
  }
  return payload
}

const normalizeSeason = (value: unknown, id: string) => {
  if (!value || typeof value !== 'object') return null
  const payload = { ...(value as Record<string, unknown>), id }
  if (!payload.updatedAt) {
    payload.updatedAt = payload.createdAt || Date.now()
  }
  return payload
}

const loadTryouts = async (sql: SqlClient, userId: string) => {
  const rows = await sql<{ id: string; payload: unknown }[]>`
    select id, payload
    from tryouts
    where user_id = ${userId}
  `

  const tryouts: Record<string, unknown> = {}
  for (const row of rows) {
    if (!row?.id) continue
    if (row.payload && typeof row.payload === 'object') {
      tryouts[row.id] = row.payload as Record<string, unknown>
    }
  }
  return tryouts
}

const loadTeams = async (sql: SqlClient, userId: string) => {
  const rows = await sql<{ id: string; payload: unknown }[]>`
    select id, payload
    from teams
    where user_id = ${userId}
  `

  const teams: Record<string, unknown> = {}
  for (const row of rows) {
    if (!row?.id) continue
    if (row.payload && typeof row.payload === 'object') {
      teams[row.id] = row.payload as Record<string, unknown>
    }
  }
  return teams
}

const saveTryouts = async (sql: SqlClient, userId: string, tryouts: Record<string, Record<string, unknown>>) => {
  for (const [id, payload] of Object.entries(tryouts)) {
    await sql`
      insert into tryouts (user_id, id, payload, updated_at)
      values (${userId}, ${id}, ${JSON.stringify(payload)}::jsonb, now())
      on conflict (user_id, id)
      do update set payload = excluded.payload, updated_at = now()
    `
  }
}

const saveTeams = async (sql: SqlClient, userId: string, teams: Record<string, Record<string, unknown>>) => {
  for (const [id, payload] of Object.entries(teams)) {
    await sql`
      insert into teams (user_id, id, payload, updated_at)
      values (${userId}, ${id}, ${JSON.stringify(payload)}::jsonb, now())
      on conflict (user_id, id)
      do update set payload = excluded.payload, updated_at = now()
    `
  }
}

const loadSeasons = async (sql: SqlClient, userId: string) => {
  const rows = await sql<{ id: string; payload: unknown }[]>`
    select id, payload
    from seasons
    where user_id = ${userId}
  `

  const seasons: Record<string, unknown> = {}
  for (const row of rows) {
    if (!row?.id) continue
    if (row.payload && typeof row.payload === 'object') {
      seasons[row.id] = row.payload as Record<string, unknown>
    }
  }
  return seasons
}

const saveSeasons = async (sql: SqlClient, userId: string, seasons: Record<string, Record<string, unknown>>) => {
  for (const [id, payload] of Object.entries(seasons)) {
    await sql`
      insert into seasons (user_id, id, payload, updated_at)
      values (${userId}, ${id}, ${JSON.stringify(payload)}::jsonb, now())
      on conflict (user_id, id)
      do update set payload = excluded.payload, updated_at = now()
    `
  }
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
  const tryouts = body?.tryouts
  if (!tryouts || typeof tryouts !== 'object') {
    return jsonResponse({ error: 'Invalid payload.' }, { status: 400 })
  }

  const sql = getSqlClient()
  if (!sql) {
    await writeAuditLog({
      action: 'cloud_sync',
      status: 'failed',
      functionName: 'db-sync',
      statusCode: 503,
      userId,
      error: 'Database not configured.',
    })
    return jsonResponse(
      { error: 'Database not configured.', notConfigured: true },
      { status: 503 }
    )
  }

  try {
    await ensureSchema(sql)
  } catch {
    await writeAuditLog({
      action: 'cloud_sync',
      status: 'failed',
      functionName: 'db-sync',
      statusCode: 500,
      userId,
      error: 'Failed to ensure schema.',
    })
    return jsonResponse({ error: 'Database error.' }, { status: 500 })
  }

  let existing: Record<string, unknown> = {}
  try {
    existing = await loadTryouts(sql, userId)
  } catch {
    await writeAuditLog({
      action: 'cloud_sync',
      status: 'failed',
      functionName: 'db-sync',
      statusCode: 500,
      userId,
      error: 'Failed to load tryouts.',
    })
    return jsonResponse({ error: 'Database error.' }, { status: 500 })
  }

  const merged: Record<string, Record<string, unknown>> = {}
  const incoming = tryouts as Record<string, unknown>
  const ids = new Set([...Object.keys(existing), ...Object.keys(incoming)])

  for (const id of ids) {
    const local = normalizeTryout(incoming[id], id)
    const remote = normalizeTryout(existing[id], id)
    if (!local && !remote) continue
    if (!local) {
      merged[id] = remote as Record<string, unknown>
      continue
    }
    if (!remote) {
      merged[id] = local
      continue
    }
    const localUpdated = coerceUpdatedAt(local.updatedAt)
    const remoteUpdated = coerceUpdatedAt(remote.updatedAt)
    merged[id] = localUpdated >= remoteUpdated ? local : (remote as Record<string, unknown>)
  }

  try {
    await saveTryouts(sql, userId, merged)
  } catch {
    await writeAuditLog({
      action: 'cloud_sync',
      status: 'failed',
      functionName: 'db-sync',
      statusCode: 500,
      userId,
      error: 'Failed to save tryouts.',
    })
    return jsonResponse({ error: 'Database error.' }, { status: 500 })
  }

  // Sync teams
  const incomingTeams = body?.teams
  let mergedTeams: Record<string, Record<string, unknown>> = {}
  if (incomingTeams && typeof incomingTeams === 'object') {
    let existingTeams: Record<string, unknown> = {}
    try {
      existingTeams = await loadTeams(sql, userId)
    } catch {
      // Teams sync is best-effort; don't fail the whole sync
    }

    const incomingTeamsMap = incomingTeams as Record<string, unknown>
    const teamIds = new Set([...Object.keys(existingTeams), ...Object.keys(incomingTeamsMap)])
    for (const id of teamIds) {
      const local = normalizeTeam(incomingTeamsMap[id], id)
      const remote = normalizeTeam(existingTeams[id], id)
      if (!local && !remote) continue
      if (!local) { mergedTeams[id] = remote as Record<string, unknown>; continue }
      if (!remote) { mergedTeams[id] = local; continue }
      // Keep whichever was created later (teams are immutable except for potential name edits)
      const localCreated = typeof local.createdAt === 'number' ? local.createdAt : 0
      const remoteCreated = typeof remote.createdAt === 'number' ? remote.createdAt : 0
      mergedTeams[id] = localCreated >= remoteCreated ? local : (remote as Record<string, unknown>)
    }

    try {
      await saveTeams(sql, userId, mergedTeams)
    } catch {
      // Best-effort
    }
  }

  // Sync seasons
  const incomingSeasons = body?.seasons
  let mergedSeasons: Record<string, Record<string, unknown>> = {}
  if (incomingSeasons && typeof incomingSeasons === 'object') {
    let existingSeasons: Record<string, unknown> = {}
    try {
      existingSeasons = await loadSeasons(sql, userId)
    } catch {
      // Seasons sync is best-effort; don't fail the whole sync
    }

    const incomingSeasonsMap = incomingSeasons as Record<string, unknown>
    const seasonIds = new Set([...Object.keys(existingSeasons), ...Object.keys(incomingSeasonsMap)])
    for (const id of seasonIds) {
      const local = normalizeSeason(incomingSeasonsMap[id], id)
      const remote = normalizeSeason(existingSeasons[id], id)
      if (!local && !remote) continue
      if (!local) { mergedSeasons[id] = remote as Record<string, unknown>; continue }
      if (!remote) { mergedSeasons[id] = local; continue }
      // Keep whichever was updated more recently
      const localUpdated = coerceUpdatedAt(local.updatedAt)
      const remoteUpdated = coerceUpdatedAt(remote.updatedAt)
      mergedSeasons[id] = localUpdated >= remoteUpdated ? local : (remote as Record<string, unknown>)
    }

    try {
      await saveSeasons(sql, userId, mergedSeasons)
    } catch {
      // Best-effort
    }
  }

  await writeAuditLog({
    action: 'cloud_sync',
    status: 'ok',
    functionName: 'db-sync',
    statusCode: 200,
    userId,
    tryoutCount: Object.keys(merged).length,
    teamCount: Object.keys(mergedTeams).length,
    seasonCount: Object.keys(mergedSeasons).length,
  })

  return jsonResponse({
    tryouts: merged,
    ...(Object.keys(mergedTeams).length > 0 ? { teams: mergedTeams } : {}),
    ...(Object.keys(mergedSeasons).length > 0 ? { seasons: mergedSeasons } : {})
  })
}

export const config: Config = {
  path: '/api/db/sync',
  method: 'POST',
}
