import type { Config } from '@netlify/functions'
import { allow, pruneExpired } from './_ratelimit.mts'
import { createLogger } from './_logger.mts'

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status })

const log = createLogger('ai-player')

/* 20 AI requests per IP per hour */
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

  const { tryout, player, metrics, recent_evals } = body as Record<string, unknown>

  const playerName = String((player as Record<string, unknown>)?.name || 'Unknown Player')
  const position = String((player as Record<string, unknown>)?.pos || 'Unknown Position')
  const sport = String((tryout as Record<string, unknown>)?.sport || 'Hockey')
  const overall = Number((metrics as Record<string, unknown>)?.overall ?? null)
  const categories = (metrics as Record<string, unknown>)?.categories as Record<string, number> | null
  const evalCount = Number((metrics as Record<string, unknown>)?.evals || 0)

  const catLines = categories
    ? Object.entries(categories)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `  ${k}: ${Number(v).toFixed(2)}`)
        .join('\n')
    : '  No category scores available'

  const evalLines = Array.isArray(recent_evals)
    ? (recent_evals as Record<string, unknown>[])
        .map(e =>
          [
            e.date ? `Date: ${e.date}` : null,
            e.evaluator ? `Evaluator: ${e.evaluator}` : null,
            e.recommendation ? `Recommendation: ${e.recommendation}` : null,
            e.strengths ? `Strengths: ${e.strengths}` : null,
            e.improve ? `Areas to improve: ${e.improve}` : null,
          ]
            .filter(Boolean)
            .join(' | ')
        )
        .filter(Boolean)
        .join('\n')
    : 'No recent evaluations'

  const prompt = `You are an expert ${sport} scout and player development analyst. Analyze the following player assessment data and provide a concise, professional evaluation.

Player: ${playerName}
Position: ${position}
Sport: ${sport}
Overall Score: ${overall !== null && !Number.isNaN(overall) ? overall.toFixed(2) + '/5.00' : 'Not yet scored'}
Number of Evaluations: ${evalCount}

Category Scores:
${catLines}

Recent Evaluations:
${evalLines}

Respond ONLY with a valid JSON object — no markdown, no backticks, no preamble. Use exactly this structure:
{
  "summary": "2-3 sentence professional assessment of this player's current level and trajectory",
  "key_strengths": ["strength 1", "strength 2"],
  "key_growth": ["growth area 1", "growth area 2"],
  "role_fit": "one sentence describing the best role or line fit for this player",
  "confidence": 0.85,
  "trend": "improving"
}

For confidence use a value between 0 and 1 representing how confident you are based on the available data. For trend use one of: improving, steady, inconsistent, or insufficient_data.`

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
        max_tokens: 600,
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
      key_strengths: Array.isArray(parsed.key_strengths) ? parsed.key_strengths.map(String) : [],
      key_growth: Array.isArray(parsed.key_growth) ? parsed.key_growth.map(String) : [],
      role_fit: String(parsed.role_fit || ''),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      trend: String(parsed.trend || 'insufficient_data'),
    })
  } catch (err) {
    log.error('Unhandled error', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Failed to generate AI assessment.' }, 500)
  }
}

export const config: Config = {
  path: '/api/ai/player',
  method: ['POST', 'OPTIONS'],
}
