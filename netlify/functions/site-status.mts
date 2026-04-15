import type { Config, Context } from '@netlify/functions'

const json = (body: Record<string, unknown>, init?: ResponseInit) => Response.json(body, init)

export default async (req: Request, context: Context) => {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed.' }, { status: 405 })
  }

  const url = new URL(req.url)

  return json({
    status: 'ok',
    checkedAt: new Date().toISOString(),
    service: 'athlete-assessment-systems',
    endpoint: url.pathname,
    requestId: context.requestId || null,
    deploy: {
      id: context.deploy?.id || null,
      context: context.deploy?.context || null,
      published: context.deploy?.published ?? null,
    },
    site: {
      id: context.site?.id || null,
      name: context.site?.name || null,
      url: context.site?.url || null,
    },
    server: {
      region: context.server?.region || null,
    },
  })
}

export const config: Config = {
  path: '/api/status',
  method: 'GET',
}
