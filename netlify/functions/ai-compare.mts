import type { Config } from '@netlify/functions'
import { allow, pruneExpired } from './_ratelimit.mts'
import { createLogger } from './_logger.mts'

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status })

const log = createLogger('ai-compare')

/* 20 AI requests per IP per hour (shared window key with ai-player via same IP) */
const AI_RATE_MAX = 20
const AI_RATE_WINDOW_MS = 60 * 60 * 1000

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405)
  }

  const clientIp = String(req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim()
  pruneExpired()
  if (!allow(`ai:${clientIp}`, AI_RATE_MAX, AI_RATE_WINDOW_MS)) {
    log.warn('AI rate limit exceeded', { ip: clientIp })
    return json({ error: 'Too many requests. Please try again later.' }, 429)
  }

  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY') || ''
  if (!apiKey) {
    return json({ error: 'AI service not configured. Set ANTHROPIC_API_KEY in Netlify environment variables.' }, 503)
  }

  const body = await req.json().catch(() => null)
  if (!body) {
    return json({ error: 'Invalid request body.' }, 400)
  }

  const { tryout, players } = body as Record<string, unknown>
  const playerList = Array.isArray(players) ? (players as Record<string, unknown>[]) : []

  if (playerList.length < 2) {
    return json({ error: 'At least two players required for comparison.' }, 400)
  }

  const sport = String((tryout as Record<string, unknown>)?.sport || 'Hockey')

  const playerSummaries = playerList.map(p => {
    const cats = p.categories as Record<string, number> | null
    const catLines = cats
      ? Object.entries(cats)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => `${k}: ${Number(v).toFixed(2)}`)
          .join(', ')
      : 'No category data'
    const overall = Number(p.overall ?? null)
    return `- ${p.name} (#${p.jersey || '?'}, ${p.pos || 'Unknown'}): Overall ${!Number.isNaN(overall) ? overall.toFixed(2) : 'N/A'} | ${catLines} | ${p.evals} eval(s)`
  }).join('\n')

  const prompt = `You are an expert ${sport} scout. Compare the following players and provide a professional side-by-side analysis to help a coach make roster decisions.

Sport: ${sport}
Players:
${playerSummaries}

Respond ONLY with a valid JSON object — no markdown, no backticks, no preamble. Use exactly this structure:
{
  "summary": "2-3 sentence overview comparing these players at a high level",
  "edge": "name of the player with the overall scoring edge and why in one sentence",
  "best_fit": "which player fits which role — one sentence per player",
  "watch_list": ["player name who deserves a second look and why"],
  "category_leaders": {"category_name": "player name who leads this category"},
  "recommendation": "one clear coaching recommendation about how to use these players together or which to prioritize"
}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text().catch(() => '')
      log.error('Anthropic API error', { status: response.status, error: err instanceof Error ? err.message : String(err) })
      return json({ error: 'AI service error.' }, 502)
    }

    const anthropicData = await response.json() as {
      content?: { type: string; text: string }[]
    }
    const rawText = anthropicData?.content?.find(b => b.type === 'text')?.text || ''
    const cleaned = rawText.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)

    return json({
      summary: String(parsed.summary || ''),
      edge: String(parsed.edge || ''),
      best_fit: String(parsed.best_fit || ''),
      watch_list: Array.isArray(parsed.watch_list) ? parsed.watch_list.map(String) : [],
      category_leaders: parsed.category_leaders && typeof parsed.category_leaders === 'object'
        ? Object.fromEntries(Object.entries(parsed.category_leaders).map(([k, v]) => [k, String(v)]))
        : null,
      recommendation: String(parsed.recommendation || ''),
    })
  } catch (err) {
    log.error('Unhandled error', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Failed to generate AI comparison.' }, 500)
  }
}

export const config: Config = {
  path: '/api/ai/compare',
  method: ['POST', 'OPTIONS'],
}
