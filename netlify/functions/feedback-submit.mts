import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const feedbackStore = getStore({ name: 'feedback', consistency: 'strong' })

type FeedbackRatings = {
  overallExperience: number
  easeOfUse: number
  teamHubScheduling: number
  valueForMoney: number
}

type FeedbackAnswers = {
  whatIsWorkingWell: string
  whatCanBeImproved: string
}

type FeedbackSubmission = {
  id: string
  userId: string
  userEmail: string
  teamName: string
  seasonId: string
  seasonSport: string
  seasonYear: string
  ratings: FeedbackRatings
  answers: FeedbackAnswers
  appVersion: string
  submittedAt: string
}

const json = (body: Record<string, unknown>, init?: ResponseInit) => Response.json(body, init)

const toStringSafe = (value: unknown, maxLen = 2000) => String(value || '').trim().slice(0, maxLen)

const toRating = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const rounded = Math.round(n)
  if (rounded < 1 || rounded > 5) return 0
  return rounded
}

const readBody = async (req: Request) => {
  const raw = await req.text().catch(() => '')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, { status: 405 })
  }

  const body = await readBody(req)
  if (!body) {
    return json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const ratingsInput =
    body.ratings && typeof body.ratings === 'object' && !Array.isArray(body.ratings)
      ? (body.ratings as Record<string, unknown>)
      : {}
  const answersInput =
    body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
      ? (body.answers as Record<string, unknown>)
      : {}

  const ratings: FeedbackRatings = {
    overallExperience: toRating(ratingsInput.overallExperience),
    easeOfUse: toRating(ratingsInput.easeOfUse),
    teamHubScheduling: toRating(ratingsInput.teamHubScheduling),
    valueForMoney: toRating(ratingsInput.valueForMoney),
  }

  const missingRatings = Object.entries(ratings)
    .filter(([, value]) => value < 1 || value > 5)
    .map(([key]) => key)

  if (missingRatings.length) {
    return json({ error: 'Missing required rating values.', missingRatings }, { status: 400 })
  }

  const submittedAtInput = toStringSafe(body.submittedAt, 120)
  const submittedAtMs = Date.parse(submittedAtInput)
  const submittedAt = Number.isFinite(submittedAtMs) ? new Date(submittedAtMs).toISOString() : new Date().toISOString()

  const item: FeedbackSubmission = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    userId: toStringSafe(body.userId, 256) || 'anonymous',
    userEmail: toStringSafe(body.userEmail, 256).toLowerCase(),
    teamName: toStringSafe(body.teamName, 256) || 'Unknown Team',
    seasonId: toStringSafe(body.seasonId, 256),
    seasonSport: toStringSafe(body.seasonSport, 120),
    seasonYear: toStringSafe(body.seasonYear, 40),
    ratings,
    answers: {
      whatIsWorkingWell: toStringSafe(answersInput.whatIsWorkingWell, 4000),
      whatCanBeImproved: toStringSafe(answersInput.whatCanBeImproved, 4000),
    },
    appVersion: toStringSafe(body.appVersion, 200),
    submittedAt,
  }

  const existing = await feedbackStore.get('feedback/all', { type: 'json' })
  const all = Array.isArray(existing) ? [...existing] : []
  all.push(item)
  await feedbackStore.setJSON('feedback/all', all)

  return json({ ok: true, message: 'Feedback submitted.', submittedAt: item.submittedAt, id: item.id })
}

export const config: Config = {
  path: '/api/feedback/submit',
  method: 'POST',
}
