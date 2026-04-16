import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const store = getStore({ name: 'shared-results', consistency: 'strong' })
const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  Response.json(body, init)

export default async (req: Request, context: Context) => {
  // POST /api/share-results — create a share token (requires auth)
  if (req.method === 'POST') {
    const authHeader = req.headers.get('authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await req.json().catch(() => null)
    if (!body?.data) return jsonResponse({ error: 'Missing data' }, { status: 400 })

    const token = Array.from(
      { length: 12 },
      () => Math.random().toString(36)[2]
    ).join('')
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days

    await store.setJSON(token, {
      data: body.data,
      label: body.label || 'Results',
      expiresAt,
      createdAt: Date.now(),
    })

    return jsonResponse({ token, expiresAt })
  }

  // GET /api/share-results?token=xxx — fetch shared data (public)
  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token')
    if (!token) return jsonResponse({ error: 'Missing token' }, { status: 400 })

    const record = await store.get(token, { type: 'json' }).catch(() => null)
    if (!record) return jsonResponse({ error: 'Not found or expired' }, { status: 404 })

    const rec = record as { expiresAt: number; data: unknown; label: string }
    if (Date.now() > rec.expiresAt) {
      await store.delete(token).catch(() => {})
      return jsonResponse({ error: 'Link has expired' }, { status: 410 })
    }

    return jsonResponse({ data: rec.data, label: rec.label, expiresAt: rec.expiresAt })
  }

  return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
}

export const config: Config = {
  path: '/api/share-results',
  method: ['GET', 'POST'],
}
