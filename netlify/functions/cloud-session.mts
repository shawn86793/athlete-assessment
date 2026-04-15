import type { Config } from '@netlify/functions'
import { createLogger } from './_logger.mts'
import { getStore } from '@netlify/blobs'

const jsonResponse = (body: Record<string, unknown>, init?: ResponseInit) =>
  Response.json(body, init)

const log = createLogger('cloud-session')

let _store: ReturnType<typeof getStore> | null = null
const cloudStore = () => {
  if (!_store) _store = getStore({ name: 'cloud-tryouts', consistency: 'strong' })
  return _store
}

const isBlobsNotConfigured = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes('netlify blobs')
}

const coerceUpdatedAt = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const normalizeTryout = (value: unknown) => {
  if (!value || typeof value !== 'object') return null
  const payload = { ...(value as Record<string, unknown>) }
  if (!coerceUpdatedAt(payload.updatedAt)) {
    payload.updatedAt = Date.now()
  }
  return payload
}

const CODE_LENGTH = 6
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const generateCode = () => {
  const bytes = new Uint8Array(CODE_LENGTH)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('')
}

const generateUniqueCode = async (attempts = 6) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = generateCode()
    const existing = await cloudStore().get(code, { type: 'json' })
    if (!existing) return code
  }
  return null
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  const body = await req.json().catch(() => null)
  const tryout = body?.tryout
  if (!tryout || typeof tryout !== 'object') {
    return jsonResponse({ error: 'Invalid payload.' }, { status: 400 })
  }

  const payload = normalizeTryout(tryout)
  if (!payload || !payload.id) {
    return jsonResponse({ error: 'Invalid payload.' }, { status: 400 })
  }

  try {
    const code = await generateUniqueCode()
    if (!code) {
      return jsonResponse({ error: 'Unable to generate code.' }, { status: 503 })
    }

    payload.cloud = { ...(payload.cloud as Record<string, unknown>), id: code, enabled: true }

    await cloudStore().set(code, JSON.stringify(payload), { metadata: { contentType: 'application/json' } })

    return jsonResponse({ id: code })
  } catch (error) {
    if (isBlobsNotConfigured(error)) {
      return jsonResponse(
        { error: 'Cloud storage not configured.', notConfigured: true },
        { status: 503 }
      )
    }
    return jsonResponse({ error: 'Cloud storage error.' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/cloud/session',
  method: 'POST',
}
