import type { Config } from '@netlify/functions'
import { ensureSchema, getSqlClient } from './_neon.mts'
import {
  cloudStore,
  jsonResponse,
  readJsonBody,
  requireSuperAdminOr401,
  seasonStore,
  writeAuditLog,
} from './_admin.mts'

const expectedCode = (userId: string) => `DELETE-${userId}`

export default async (req: Request) => {
  const auth = requireSuperAdminOr401(req)
  if (auth instanceof Response) return auth

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const body = await readJsonBody(req)
  const userId = String(body?.userId || '').trim()
  const confirmationCode = String(body?.confirmationCode || '').trim()
  const note = String(body?.note || '').trim()

  if (!userId || !confirmationCode) {
    return jsonResponse({ error: 'userId and confirmationCode are required.' }, { status: 400 })
  }

  if (confirmationCode !== expectedCode(userId)) {
    return jsonResponse({ error: 'Invalid confirmation code.' }, { status: 400 })
  }

  const sql = getSqlClient()
  const cloudIds: string[] = []

  if (sql) {
    await ensureSchema(sql)
    const tryouts = await sql<{ payload: unknown }[]>`
      select payload
      from tryouts
      where user_id = ${userId}
    `
    for (const row of tryouts) {
      const payload = row.payload as Record<string, unknown>
      const cloudId = String((payload?.cloud as Record<string, unknown> | undefined)?.id || '').trim()
      if (cloudId) cloudIds.push(cloudId)
    }

    await sql`delete from tryouts where user_id = ${userId}`
    await sql`delete from teams where user_id = ${userId}`
    await sql`delete from seasons where user_id = ${userId}`
  }

  await seasonStore.delete(`users/${userId}/profile`).catch(() => undefined)
  await seasonStore.delete(`users/${userId}/seasons`).catch(() => undefined)

  for (const cloudId of cloudIds) {
    await cloudStore.delete(cloudId).catch(() => undefined)
  }

  await writeAuditLog({
    action: 'delete_user',
    status: 'ok',
    adminEmail: auth.email,
    userId,
    note,
  })

  return jsonResponse({ ok: true, userId })
}

export const config: Config = {
  path: '/api/admin/delete-user',
  method: 'POST',
}
