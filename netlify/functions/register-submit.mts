import type { Config } from '@netlify/functions'
import { allow, pruneExpired, rateLimitHeaders } from './_ratelimit.mts'
import { createLogger } from './_logger.mts'
import { validate } from './_validate.mts'
import { getStore } from '@netlify/blobs'

/* ── stores ── */
let _cloudStore: ReturnType<typeof getStore> | null = null
let _regStore: ReturnType<typeof getStore> | null = null

const cloudStore = () => {
  if (!_cloudStore) _cloudStore = getStore({ name: 'cloud-tryouts', consistency: 'strong' })
  return _cloudStore
}
const registrationStore = () => {
  if (!_regStore) _regStore = getStore({ name: 'registrations', consistency: 'strong' })
  return _regStore
}

/* ── constants ── */
const MAX_RETRIES = 3
const BACKOFF_BASE_MS = 200
const log = createLogger("register-submit")

/* ── event code validation ── */
const EVENT_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/
const isValidEventCode = (code: string) => EVENT_CODE_RE.test(code)

/* ── rate limit: 10 submissions per IP per 15 minutes ── */
const SUBMIT_RATE_MAX = 10
const SUBMIT_RATE_WINDOW_MS = 15 * 60 * 1000

const SPORT_POSITIONS: Record<string, string[]> = {
  Hockey: ['Forward', 'Defence', 'Goalie'],
  Ringette: ['Forward', 'Defence', 'Goalie'],
  Soccer: ['Forward', 'Midfielder', 'Defender', 'Goalkeeper'],
  Football: ['Quarterback', 'Running Back', 'Wide Receiver', 'Tight End', 'Offensive Line', 'Defensive Line', 'Linebacker', 'Cornerback', 'Safety', 'Kicker', 'Punter'],
  Baseball: ['Pitcher', 'Catcher', 'First Base', 'Second Base', 'Third Base', 'Shortstop', 'Left Field', 'Centre Field', 'Right Field'],
  Basketball: ['Point Guard', 'Shooting Guard', 'Small Forward', 'Power Forward', 'Centre'],
  Volleyball: ['Setter', 'Outside Hitter', 'Middle Blocker', 'Opposite Hitter', 'Libero', 'Defensive Specialist'],
  Lacrosse: ['Attack', 'Midfield', 'Defence', 'Goalie'],
  Wrestling: ['45kg', '50kg', '55kg', '60kg', '65kg', '73kg', '82kg', '92kg', '110kg', 'Open Weight'],
  Tennis: ['Singles', 'Doubles', 'Mixed Doubles'],
  'Track and Field': ['Sprints', 'Middle Distance', 'Distance', 'Jumps', 'Throws', 'Multi-Event'],
  'Field Hockey': ['Forward', 'Midfielder', 'Defender', 'Goalkeeper'],
  Rugby: ['Prop', 'Hooker', 'Lock', 'Flanker', 'Number 8', 'Scrum Half', 'Fly Half', 'Centre', 'Wing', 'Fullback'],
  'Water Polo': ['Goalkeeper', 'Centre Forward', 'Centre Back', 'Wing', 'Driver'],
  'Ultimate Frisbee': ['Handler', 'Cutter', 'Hybrid'],
  Softball: ['Pitcher', 'Catcher', 'Infield', 'Outfield'],
  Other: ['Forward', 'Midfielder', 'Defender', 'Goalkeeper', 'Guard', 'Centre', 'Utility'],
}
const getPositionsForSport = (sport: unknown) => {
  const normalized = String(sport || '').trim().toLowerCase()
  const key = Object.keys(SPORT_POSITIONS).find((item) => item.toLowerCase() === normalized) || 'Other'
  const positions = SPORT_POSITIONS[key] || SPORT_POSITIONS.Other
  return [...positions!, 'Sort Out']
}

/* ── helpers ── */
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const jsonRes = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: corsHeaders })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const escapeHTML = (v: unknown) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/* ── cloud roster helpers ── */
const generateId = () => {
  const bytes = new Uint8Array(12)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const coerceTimestamp = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0
const toTrimmedString = (value: unknown) => String(value ?? '').trim()
const normalizeRegistrationId = (value: unknown) => toTrimmedString(value)
const rosterStorageKey = (eventCode: string) => `roster:${eventCode}`
const MAX_ROSTER_EDIT_RETRIES = 6

const CLOUD_MAX_RETRIES = 6

async function appendPlayerToCloudRoster(eventCode: string, player: Record<string, unknown>): Promise<boolean> {
  const playerId = String(player.id || '').trim()
  if (!playerId) return false

  for (let attempt = 0; attempt < CLOUD_MAX_RETRIES; attempt++) {
    let currentEntry: { data: unknown; etag?: string } | null = null
    try {
      currentEntry = await cloudStore().getWithMetadata(eventCode, { type: 'json' })
    } catch {
      if (attempt < CLOUD_MAX_RETRIES - 1) continue
      return false
    }

    if (!currentEntry || !currentEntry.data || typeof currentEntry.data !== 'object') {
      return false
    }

    const assessment = currentEntry.data as Record<string, unknown>
    const roster = Array.isArray(assessment.roster) ? [...assessment.roster] : []

    const exists = roster.some(
      (entry) => String((entry as Record<string, unknown>)?.id || '').trim() === playerId
    )
    if (exists) return true

    roster.push(player)

    const next = {
      ...assessment,
      roster,
      updatedAt: Math.max(
        Date.now(),
        coerceTimestamp(assessment.updatedAt),
        coerceTimestamp(player.createdAt)
      ),
    }

    try {
      if (currentEntry.etag) {
        const result = await cloudStore().set(eventCode, JSON.stringify(next), {
          metadata: { contentType: 'application/json' },
          onlyIfMatch: currentEntry.etag,
        })
        if (result && result.modified === false) continue
      } else {
        await cloudStore().set(eventCode, JSON.stringify(next), {
          metadata: { contentType: 'application/json' },
        })
      }
      return true
    } catch {
      if (attempt >= CLOUD_MAX_RETRIES - 1) return false
    }
  }
  return false
}

/* ── email ── */
async function sendConfirmationEmail(args: {
  to: string
  playerName: string
  eventName: string
  eventType: string
  eventDate: string
  sport: string
  position: string
  yearOfBirth: string
  currentTeam: string
  guardianName: string
}): Promise<boolean> {
  const sendgridKey = Netlify.env.get('SENDGRID_API_KEY') || ''
  const resendKey = Netlify.env.get('RESEND_API_KEY') || ''
  const fromEmail = Netlify.env.get('REGISTRATION_EMAIL_FROM') || 'noreply@athleteassessmentsystems.com'
  const fromName = Netlify.env.get('REGISTRATION_EMAIL_FROM_NAME') || 'Athlete Assessment Systems'

  const subject = `Registration Confirmed — ${args.eventName}`

  const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f3f7ff;">
  <div style="max-width:600px;margin:0 auto;padding:30px 16px;">
    <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #d9e6ea;">
      <h1 style="color:#17324a;font-size:22px;margin:0 0 8px;">Registration Confirmed</h1>
      <p style="color:#5a6f7f;margin:0 0 20px;font-size:15px;">
        ${escapeHTML(args.eventName)}${args.eventDate ? ` — ${escapeHTML(args.eventDate)}` : ''}
      </p>
      <p style="color:#17324a;font-size:15px;margin:0 0 16px;">
        Hi ${escapeHTML(args.guardianName)},
      </p>
      <div style="background:#e9fff3;border:1px solid #9ee7be;border-radius:8px;padding:12px;margin:0 0 18px;">
        <strong style="color:#0f5c33;">${escapeHTML(args.playerName)}</strong>
        <span style="color:#0f5c33;"> has been successfully registered for ${escapeHTML(args.eventName)}.</span>
      </div>
      <table style="width:100%;font-size:14px;color:#315269;border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-weight:700;">Player</td><td style="padding:6px 0;">${escapeHTML(args.playerName)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:700;">Event Type</td><td style="padding:6px 0;">${escapeHTML(args.eventType)}</td></tr>
        ${args.eventDate ? `<tr><td style="padding:6px 0;font-weight:700;">Date</td><td style="padding:6px 0;">${escapeHTML(args.eventDate)}</td></tr>` : ''}
        <tr><td style="padding:6px 0;font-weight:700;">Year of Birth</td><td style="padding:6px 0;">${escapeHTML(args.yearOfBirth)}</td></tr>
        ${args.sport ? `<tr><td style="padding:6px 0;font-weight:700;">Sport</td><td style="padding:6px 0;">${escapeHTML(args.sport)}</td></tr>` : ''}
        ${args.position ? `<tr><td style="padding:6px 0;font-weight:700;">Position</td><td style="padding:6px 0;">${escapeHTML(args.position)}</td></tr>` : ''}
        ${args.currentTeam ? `<tr><td style="padding:6px 0;font-weight:700;">Current Team</td><td style="padding:6px 0;">${escapeHTML(args.currentTeam)}</td></tr>` : ''}
      </table>
      <div style="background:#f8fafc;border-radius:8px;padding:12px;margin:18px 0 0;">
        <p style="margin:0;font-size:13px;color:#64748b;">Authorization has been recorded for this registration.</p>
      </div>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0;" />
      <p style="color:#17324a;font-size:14px;margin:0 0 6px;">
        Thank you for registering. We'll be in touch with further details.
      </p>
      <p style="color:#5a6f7f;font-size:13px;margin:16px 0 0;">
        ${escapeHTML(fromName)}
      </p>
    </div>
  </div>
</body></html>`

  const textBody = `Registration Confirmed — ${args.eventName}

Hi ${args.guardianName},

${args.playerName} has been successfully registered for ${args.eventName}.

Player: ${args.playerName}
Event Type: ${args.eventType}${args.eventDate ? `\nDate: ${args.eventDate}` : ''}
Year of Birth: ${args.yearOfBirth}${args.sport ? `\nSport: ${args.sport}` : ''}${args.position ? `\nPosition: ${args.position}` : ''}${args.currentTeam ? `\nCurrent Team: ${args.currentTeam}` : ''}

Authorization has been recorded for this registration.

Thank you for registering. We'll be in touch with further details.

${fromName}`

  if (sendgridKey) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sendgridKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: args.to }] }],
          from: { email: fromEmail, name: fromName },
          subject,
          content: [
            { type: 'text/plain', value: textBody },
            { type: 'text/html', value: htmlBody },
          ],
        }),
      })
      return res.ok || res.status === 202
    } catch (err) {
      console.error('[register-submit] SendGrid error:', err instanceof Error ? err.message : err)
      return false
    }
  }

  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [args.to],
          subject,
          html: htmlBody,
          text: textBody,
        }),
      })
      return res.ok
    } catch (err) {
      console.error('[register-submit] Resend error:', err instanceof Error ? err.message : err)
      return false
    }
  }

  console.warn('[register-submit] No email provider configured.')
  return false
}

/* ── GET /api/register/event-info ── */
async function handleEventInfo(req: Request) {
  const url = new URL(req.url)
  const eventCode = String(url.searchParams.get('event') || '').trim().toUpperCase()
  if (!eventCode) return jsonRes({ error: 'Missing event parameter.' }, 400)
  if (!isValidEventCode(eventCode)) return jsonRes({ error: 'Invalid event code format.' }, 400)

  try {
    const data = await cloudStore().get(eventCode, { type: 'json' })
    const assessment = data as Record<string, unknown> | null
    if (!assessment) return jsonRes({ error: 'Event not found.' }, 404)

    const sport = String(assessment.sport || 'Hockey').trim() || 'Hockey'
    return jsonRes({
      name: String(assessment.name || 'Event'),
      sport,
      eventType: String(assessment.eventType || 'Assessment'),
      tryoutDate: String(assessment.tryoutDate || ''),
      startTime: String(assessment.startTime || ''),
      rink: String(assessment.rink || ''),
      positions: getPositionsForSport(sport).map((label) => ({ value: label, label })),
    })
  } catch {
    return jsonRes({ error: 'Failed to load event information.' }, 500)
  }
}

/* ── GET /api/register/roster ── */
async function handleGetRoster(req: Request) {
  const url = new URL(req.url)
  const eventCode = String(url.searchParams.get('event') || '').trim().toUpperCase()
  if (!eventCode) return jsonRes({ error: 'Missing event parameter.' }, 400)
  if (!isValidEventCode(eventCode)) return jsonRes({ error: 'Invalid event code format.' }, 400)

  try {
    const rosterKey = rosterStorageKey(eventCode)
    const data = await registrationStore().get(rosterKey, { type: 'json' })
    const roster = Array.isArray(data) ? data : []
    return jsonRes({ roster })
  } catch {
    return jsonRes({ roster: [] })
  }
}

const applyRegistrationChanges = (
  registration: Record<string, unknown>,
  changes: Record<string, unknown>
) => {
  const next = { ...registration }
  for (const [key, value] of Object.entries(changes)) {
    switch (key) {
      case 'firstName':
      case 'lastName':
      case 'yearOfBirth':
      case 'currentTeam':
      case 'currentLevel':
      case 'positionTryingOutFor':
      case 'aboutPlayer':
      case 'sortOut':
        next.sortOut = value === true || String(value).toLowerCase() === 'yes'
        break
      case 'guardianName':
      case 'guardianEmail':
      case 'guardianPhone':
      case 'status':
        next[key] = toTrimmedString(value)
        break
      case 'movedToRoster':
        next.movedToRoster = value === true
        break
      default:
        break
    }
  }
  return next
}

async function updateRegistrationsWithRetry(
  eventCode: string,
  updater: (roster: Array<Record<string, unknown>>) => {
    roster: Array<Record<string, unknown>>
    changedCount: number
  }
) {
  const key = rosterStorageKey(eventCode)
  for (let attempt = 0; attempt < MAX_ROSTER_EDIT_RETRIES; attempt += 1) {
    const entry = await registrationStore().getWithMetadata(key, { type: 'json' }).catch(() => null)
    const existing = (entry as { data: unknown; etag?: string } | null)?.data
    const roster = Array.isArray(existing) ? [...(existing as Array<Record<string, unknown>>)] : []
    const result = updater(roster)
    const etag = (entry as { etag?: string } | null)?.etag

    try {
      if (etag) {
        const saveResult = await registrationStore().set(key, JSON.stringify(result.roster), {
          metadata: { contentType: 'application/json' },
          onlyIfMatch: etag,
        })
        if (saveResult && (saveResult as { modified?: boolean }).modified === false) {
          await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt))
          continue
        }
      } else {
        await registrationStore().set(key, JSON.stringify(result.roster), {
          metadata: { contentType: 'application/json' },
        })
      }
      return result
    } catch {
      if (attempt >= MAX_ROSTER_EDIT_RETRIES - 1) {
        throw new Error('Failed to save registrations.')
      }
      await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt))
    }
  }
  throw new Error('Failed to save registrations.')
}

async function handlePatchRoster(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body) return jsonRes({ success: false, error: 'Invalid request body.' }, 400)

  const eventCode = toTrimmedString(body.eventId).toUpperCase()
  const ids = Array.isArray(body.registrationIds)
    ? body.registrationIds.map(normalizeRegistrationId).filter(Boolean)
    : []
  const uniqueIds = Array.from(new Set(ids))
  const changes = body.changes && typeof body.changes === 'object' ? (body.changes as Record<string, unknown>) : null

  if (!eventCode) return jsonRes({ success: false, error: 'Missing eventId.' }, 400)
  if (!uniqueIds.length) return jsonRes({ success: false, error: 'No registrations selected.' }, 400)
  if (!changes) return jsonRes({ success: false, error: 'Missing changes payload.' }, 400)

  try {
    const result = await updateRegistrationsWithRetry(eventCode, (roster) => {
      let changedCount = 0
      const nextRoster = roster.map((registration) => {
        const id = normalizeRegistrationId(registration.registrationId)
        if (!uniqueIds.includes(id)) return registration
        changedCount += 1
        return applyRegistrationChanges(registration, changes)
      })
      return { roster: nextRoster, changedCount }
    })
    return jsonRes({ success: true, updated: result.changedCount })
  } catch {
    return jsonRes({ success: false, error: 'Could not update registrations.' }, 500)
  }
}

async function handleDeleteRoster(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body) return jsonRes({ success: false, error: 'Invalid request body.' }, 400)

  const eventCode = toTrimmedString(body.eventId).toUpperCase()
  const ids = Array.isArray(body.registrationIds)
    ? body.registrationIds.map(normalizeRegistrationId).filter(Boolean)
    : []
  const uniqueIds = new Set(ids)
  if (!eventCode) return jsonRes({ success: false, error: 'Missing eventId.' }, 400)
  if (!uniqueIds.size) return jsonRes({ success: false, error: 'No registrations selected.' }, 400)

  try {
    const result = await updateRegistrationsWithRetry(eventCode, (roster) => {
      const before = roster.length
      const nextRoster = roster.filter((registration) => !uniqueIds.has(normalizeRegistrationId(registration.registrationId)))
      return { roster: nextRoster, changedCount: before - nextRoster.length }
    })
    return jsonRes({ success: true, deleted: result.changedCount })
  } catch {
    return jsonRes({ success: false, error: 'Could not delete registrations.' }, 500)
  }
}

/* ── POST /api/register/submit ── */
async function handleSubmit(req: Request, clientIp = 'unknown') {
  /* Rate limiting: 10 submissions per IP per 15 minutes */
  pruneExpired()
  const allowed = allow(clientIp, SUBMIT_RATE_MAX, SUBMIT_RATE_WINDOW_MS)
  const submitRateHeaders = rateLimitHeaders(clientIp, SUBMIT_RATE_MAX)
  const jsonResWithRateLimit = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
    Response.json(data, {
      status,
      headers: { ...corsHeaders, ...submitRateHeaders, ...extraHeaders },
    })

  if (!allowed) {
    const resetAtSec = Number(submitRateHeaders['X-RateLimit-Reset'] || 0)
    const retryAfter = Math.max(1, resetAtSec - Math.floor(Date.now() / 1000))
    log.warn('Rate limit exceeded', { ip: clientIp })
    return jsonResWithRateLimit(
      { success: false, error: 'Too many registration attempts. Please try again later.' },
      429,
      { 'Retry-After': String(retryAfter) }
    )
  }

  const body = await req.json().catch(() => null)
  if (!body) return jsonResWithRateLimit({ success: false, error: 'Invalid request body.' }, 400)

  /* Schema validation */
  const currentYear = new Date().getUTCFullYear()
  const validation = validate(body as Record<string, unknown>, {
    eventId:              { type: 'string', required: true, minLength: 1, maxLength: 20 },
    firstName:            { type: 'string', required: true, minLength: 1, maxLength: 100 },
    lastName:             { type: 'string', required: true, minLength: 1, maxLength: 100 },
    yearOfBirth:          { type: 'string', required: true, pattern: /^[0-9]{4}$/ },
    positionTryingOutFor: { type: 'string', maxLength: 100 },
    guardianName:         { type: 'string', required: true, minLength: 1, maxLength: 200 },
    guardianEmail:        { type: 'string', required: true, email: true, maxLength: 320 },
    guardianPhone:        { type: 'string', required: true, minLength: 1, maxLength: 30 },
    currentTeam:          { type: 'string', maxLength: 200 },
    currentLevel:         { type: 'string', maxLength: 100 },
    aboutPlayer:          { type: 'string', maxLength: 2000 },
    medicalInfo:          { type: 'string', maxLength: 2000 },
    friend1Name:          { type: 'string', maxLength: 200 },
    friend2Name:          { type: 'string', maxLength: 200 },
  })
  if (!validation.ok) {
    log.warn('Registration validation failed', { ip: clientIp, errors: validation.errors })
    return jsonResWithRateLimit({ success: false, error: validation.errors.join('; ') }, 400)
  }

  const eventCode = String(body.eventId || '').trim().toUpperCase()
  if (!isValidEventCode(eventCode)) {
    return jsonResWithRateLimit({ success: false, error: 'Invalid event code format.' }, 400)
  }

  const firstName = String(body.firstName || '').trim()
  const lastName = String(body.lastName || '').trim()
  const yearOfBirth = String(body.yearOfBirth || '').trim()
  const positionTryingOutFor = String(body.positionTryingOutFor || '').trim()
  const guardianName = String(body.guardianName || '').trim()
  const guardianEmail = String(body.guardianEmail || '').trim()

  const year = Number(yearOfBirth)
  if (!Number.isInteger(year) || year < 1925 || year > currentYear) {
    return jsonResWithRateLimit({ success: false, error: 'Year of Birth must be a valid 4-digit year.' }, 400)
  }

  /* Verify event exists */
  let assessment: Record<string, unknown> | null = null
  try {
    const data = await cloudStore().get(eventCode, { type: 'json' })
    assessment = data as Record<string, unknown> | null
    if (!assessment) return jsonResWithRateLimit({ success: false, error: 'Event not found.' }, 404)
  } catch {
    return jsonResWithRateLimit({ success: false, error: 'Failed to verify event.' }, 500)
  }

  /* Check for duplicate in cloud roster (the assessor app's authoritative roster) */
  const existingRoster = Array.isArray(assessment.roster) ? assessment.roster : []
  const cloudDuplicate = existingRoster.some((r) => {
    const entry = r as Record<string, unknown>
    return (
      String(entry.first || entry.firstName || '').toLowerCase() === firstName.toLowerCase() &&
      String(entry.last || entry.lastName || '').toLowerCase() === lastName.toLowerCase() &&
      String(entry.yearOfBirth || '') === yearOfBirth
    )
  })
  if (cloudDuplicate) {
    return jsonResWithRateLimit({
      success: false,
      duplicate: true,
      error: 'A registration for this player already exists for this event.',
    })
  }

  /* Build player record in assessor-app format and append to cloud roster */
  const cloudCreatedAt = Date.now()
  const cloudPlayer: Record<string, unknown> = {
    id: generateId(),
    first: firstName,
    last: lastName,
    anonymous: false,
    jersey: '',
    pos: positionTryingOutFor,
    shoots: '',
    assignedAssessor: '',
    guardianName,
    guardianEmail,
    guardianPhone: String(body.guardianPhone || '').trim(),
    yearOfBirth,
    currentPosition: positionTryingOutFor,
    currentTeam: String(body.currentTeam || '').trim(),
    currentLevel: String(body.currentLevel || '').trim(),
    positionTryingOutFor,
    aboutChild: String(body.aboutPlayer || '').trim(),
    medicalInfo: String(body.medicalInfo || '').trim(),
    friend1Name: String(body.friend1Name || '').trim(),
    friend2Name: String(body.friend2Name || '').trim(),
    sortOut: String(body.sortOut || '').trim().toLowerCase() === 'yes',
    waiverAcceptedAt: cloudCreatedAt,
    registrationSource: 'qr',
    createdAt: cloudCreatedAt,
    updatedAt: cloudCreatedAt,
  }

  try {
    const appended = await appendPlayerToCloudRoster(eventCode, cloudPlayer)
    if (!appended) {
      console.error('[register-submit] Failed to append player to cloud roster for event', eventCode)
    }
  } catch (err) {
    console.error('[register-submit] Cloud roster append error:', err instanceof Error ? err.message : err)
  }

  const rosterKey = `roster:${eventCode}`
  const registrationId = crypto.randomUUID()
  const registeredAt = new Date().toISOString()

  const registration = {
    registrationId,
    eventId: eventCode,
    eventType: String(body.eventType || assessment.eventType || 'Assessment'),
    firstName,
    lastName,
    yearOfBirth,
    currentTeam: String(body.currentTeam || '').trim(),
    currentLevel: String(body.currentLevel || '').trim(),
    positionTryingOutFor,
    aboutPlayer: String(body.aboutPlayer || '').trim(),
    medicalInfo: String(body.medicalInfo || '').trim(),
    friend1Name: String(body.friend1Name || '').trim(),
    friend2Name: String(body.friend2Name || '').trim(),
    sortOut: String(body.sortOut || '').trim().toLowerCase() === 'yes',
    guardianName,
    guardianEmail,
    guardianPhone: String(body.guardianPhone || '').trim(),
    authorizationAccepted: true,
    registeredAt,
    status: 'registered',
  }

  /* Atomic append with retry + duplicate detection */
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const entry = await registrationStore().getWithMetadata(rosterKey, { type: 'json' }).catch(() => null)
      const existing = (entry as { data: unknown; etag?: string } | null)?.data
      const roster: Array<Record<string, unknown>> = Array.isArray(existing) ? [...(existing as Array<Record<string, unknown>>)] : []

      /* Duplicate detection: same first + last + yearOfBirth */
      const duplicate = roster.some(
        (r) =>
          String(r.firstName || '').toLowerCase() === firstName.toLowerCase() &&
          String(r.lastName || '').toLowerCase() === lastName.toLowerCase() &&
          String(r.yearOfBirth || '') === yearOfBirth
      )
      if (duplicate) {
        return jsonResWithRateLimit({
          success: false,
          duplicate: true,
          error: 'A registration for this player already exists for this event.',
        })
      }

      roster.push(registration)
      const etag = (entry as { etag?: string } | null)?.etag

      if (etag) {
        const result = await registrationStore().set(rosterKey, JSON.stringify(roster), {
          metadata: { contentType: 'application/json' },
          onlyIfMatch: etag,
        })
        if (result && (result as { modified?: boolean }).modified === false) {
          await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt))
          continue
        }
      } else {
        await registrationStore().set(rosterKey, JSON.stringify(roster), {
          metadata: { contentType: 'application/json' },
        })
      }

      /* Send confirmation email (best-effort) */
      let emailSent = false
      try {
        emailSent = await sendConfirmationEmail({
          to: guardianEmail,
          playerName: `${firstName} ${lastName}`,
          eventName: String(assessment.name || 'Event'),
          eventType: String(assessment.eventType || 'Assessment'),
          eventDate: String(assessment.tryoutDate || ''),
          sport: String(assessment.sport || ''),
          position: positionTryingOutFor,
          yearOfBirth,
          currentTeam: String(body.currentTeam || ''),
          guardianName,
        })
      } catch {
        /* email is best-effort */
      }

      return jsonResWithRateLimit({ success: true, registrationId, emailSent })
    } catch {
      if (attempt >= MAX_RETRIES - 1) {
        return jsonResWithRateLimit({ success: false, error: 'Registration could not be saved. Please try again.' }, 500)
      }
      await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt))
    }
  }

  return jsonResWithRateLimit({ success: false, error: 'Registration failed after retries.' }, 500)
}

/* ── Main handler ── */
export default async (req: Request, context?: { ip?: string }) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const clientIp = String(context?.ip || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim()
  const path = new URL(req.url).pathname

  if (req.method === 'GET' && path === '/api/register/event-info') return handleEventInfo(req)
  if (req.method === 'GET' && path === '/api/register/roster') return handleGetRoster(req)
  if (req.method === 'PATCH' && path === '/api/register/roster') return handlePatchRoster(req)
  if (req.method === 'DELETE' && path === '/api/register/roster') return handleDeleteRoster(req)
  if (req.method === 'POST' && path === '/api/register/submit') return handleSubmit(req, clientIp)

  return jsonRes({ error: 'Not found.' }, 404)
}

export const config: Config = {
  path: ['/api/register/event-info', '/api/register/submit', '/api/register/roster'],
  method: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}
