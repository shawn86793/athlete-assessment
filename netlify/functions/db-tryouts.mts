import type { Config, Context } from '@netlify/functions'
import { getUserId } from './_auth.mts'
import { ensureSchema, getSqlClient } from './_neon.mts'

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

export default async (req: Request, context: Context) => {
  const userId = getUserId(req, context)
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })
  }

  const tryoutId = context.params?.id
  if (!tryoutId) {
    return jsonResponse({ error: 'Tryout id required.' }, { status: 400 })
  }

  const sql = getSqlClient()
  if (!sql) {
    return jsonResponse(
      { error: 'Database not configured.', notConfigured: true },
      { status: 503 }
    )
  }

  try {
    await ensureSchema(sql)
  } catch {
    return jsonResponse({ error: 'Database error.' }, { status: 500 })
  }

  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null)
    const tryout = body?.tryout
    if (!tryout || typeof tryout !== 'object') {
      return jsonResponse({ error: 'Invalid payload.' }, { status: 400 })
    }

    const payload = normalizeTryout(tryout, tryoutId)
    if (!payload) {
      return jsonResponse({ error: 'Invalid payload.' }, { status: 400 })
    }

    try {
      await sql`
        insert into tryouts (user_id, id, payload, updated_at)
        values (${userId}, ${tryoutId}, ${JSON.stringify(payload)}::jsonb, now())
        on conflict (user_id, id)
        do update set payload = excluded.payload, updated_at = now()
      `
    } catch {
      return jsonResponse({ error: 'Database error.' }, { status: 500 })
    }

    return jsonResponse({ ok: true })
  }

  if (req.method === 'DELETE') {
    try {
      await sql`
        delete from tryouts
        where user_id = ${userId} and id = ${tryoutId}
      `
    } catch {
      return jsonResponse({ error: 'Database error.' }, { status: 500 })
    }

    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
}

export const config: Config = {
  path: '/api/db/tryouts/:id',
  method: ['PUT', 'DELETE'],
}
