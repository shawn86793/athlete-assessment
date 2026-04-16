import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import QRCode from 'qrcode'

let _store: ReturnType<typeof getStore> | null = null
const cloudStore = () => {
  if (!_store) _store = getStore({ name: 'cloud-tryouts', consistency: 'strong' })
  return _store
}
const MAX_WRITE_RETRIES = 6
const VERIFY_RETRY_COUNT = 6
const VERIFY_RETRY_DELAY_MS = 150

const CODE_PATTERN = /^[A-Z0-9]{4,12}$/

const normalizeCode = (value: unknown) => String(value || '').trim().toUpperCase()
const coerceTimestamp = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const isBlobsNotConfigured = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes('netlify blobs')
}

const escapeHTML = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const page = (title: string, body: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Player registration form for Athlete Assessment Systems." />
  <title>${escapeHTML(title)}</title>
  <style>
    :root{color-scheme:light;}
    body{font-family:Manrope,Arial,sans-serif;margin:0;background:linear-gradient(160deg,#f3f7ff,#edf7f4 55%,#fff8ef);color:#17324a;}
    .wrap{max-width:760px;margin:0 auto;padding:26px 16px 40px;}
    .card{background:#ffffffd9;border:1px solid #d9e6ea;border-radius:14px;padding:18px;box-shadow:0 12px 32px rgba(12,33,56,.08);}
    .qrHeader{display:flex;align-items:center;gap:10px;margin:0 0 10px;}
    .qrHeader img{height:36px;width:auto;}
    h1{margin:0 0 6px;font-size:1.5rem;}
    h2{margin:18px 0 4px;font-size:1.15rem;}
    p{margin:0 0 12px;}
    .muted{color:#5a6f7f;font-size:.95rem;}
    .opt{color:#5a6f7f;font-size:.85rem;font-weight:400;}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
    label{display:block;font-weight:700;margin:10px 0 6px;}
    input,textarea,select{width:100%;box-sizing:border-box;border:1px solid #c8d8de;border-radius:10px;padding:10px 11px;font:inherit;background:#fff;}
    input:focus,select:focus,textarea:focus{outline:2px solid #0070f3;outline-offset:-1px;border-color:#0070f3;}
    textarea{min-height:90px;resize:vertical;}
    .authRow{display:flex;gap:10px;align-items:flex-start;margin-top:14px;padding:10px 12px;border:2px solid #c8d8de;border-radius:10px;transition:border-color .15s,background .15s;}
    .authRow.authorized{border-color:#16a34a;background:#e9fff3;}
    .authRow input[type="checkbox"]{width:22px;height:22px;flex-shrink:0;margin-top:2px;accent-color:#16a34a;cursor:pointer;}
    .authCheckMark{font-size:1.3rem;color:#16a34a;font-weight:900;display:none;flex-shrink:0;margin-top:0;}
    .authRow.authorized .authCheckMark{display:block;}
    .friendBox{background:#f8fbff;border:1px solid #c8d8de;border-radius:10px;padding:12px 14px;margin-top:12px;}
    .friendBox h2{margin:0 0 8px;font-size:1rem;color:#315269;}
    .medBox{background:#fff8f8;border:1px solid #f0c0c0;border-radius:10px;padding:12px 14px;margin-top:12px;}
    .medBox h2{margin:0 0 8px;font-size:1rem;color:#7f1d1d;}
    button{margin-top:14px;border:0;border-radius:10px;padding:12px 14px;background:#0070f3;color:#fff;font-weight:700;cursor:pointer;width:100%;}
    button:hover{background:#005fcc;}
    button:focus-visible{outline:2px solid #0070f3;outline-offset:2px;}
    .banner{background:#e9fff3;color:#0f5c33;border:1px solid #9ee7be;border-radius:10px;padding:10px 12px;margin:10px 0 16px;font-weight:700;}
    .error{background:#fff2f1;color:#8c2626;border-color:#f0b7b2;}
    .meta{font-size:.95rem;color:#315269;}
    @media (max-width:700px){.grid{grid-template-columns:1fr;}}
    @media print{
      body{background:#fff;}
      .card{box-shadow:none;border-color:#d8d8d8;}
      button{display:none;}
    }
  </style>
</head>
<body><main class="wrap">${body}</main></body>
</html>`

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

const SPORT_LEVELS: Record<string, Array<{ value: string; label: string }>> = {
  Hockey: [
    { value: 'AAA', label: 'AAA' },
    { value: 'AA', label: 'AA' },
    { value: 'A', label: 'A' },
    { value: 'Select', label: 'Select' },
    { value: 'House League', label: 'House League' },
  ],
  Soccer: [
    { value: 'Premier', label: 'Premier' },
    { value: 'Division 1', label: 'Division 1' },
    { value: 'Division 2', label: 'Division 2' },
    { value: 'Recreational', label: 'Recreational' },
    { value: 'Academy', label: 'Academy' },
  ],
  Football: [
    { value: 'Varsity', label: 'Varsity' },
    { value: 'Junior Varsity', label: 'Junior Varsity' },
    { value: 'Rep', label: 'Rep' },
    { value: 'House League', label: 'House League' },
  ],
  Baseball: [
    { value: 'AAA', label: 'AAA' },
    { value: 'AA', label: 'AA' },
    { value: 'A', label: 'A' },
    { value: 'Rep', label: 'Rep' },
    { value: 'House League', label: 'House League' },
  ],
  Basketball: [
    { value: 'AAA', label: 'AAA' },
    { value: 'AA', label: 'AA' },
    { value: 'A', label: 'A' },
    { value: 'Rep', label: 'Rep' },
    { value: 'House League', label: 'House League' },
  ],
  Ringette: [
    { value: 'AAA', label: 'AAA' },
    { value: 'AA', label: 'AA' },
    { value: 'A', label: 'A' },
    { value: 'Select', label: 'Select' },
    { value: 'House League', label: 'House League' },
  ],
}

const getSportName = (assessment: Record<string, unknown>): string =>
  String(assessment.sport || 'Hockey').trim() || 'Hockey'

const registrationFormHTML = (args: {
  code: string
  assessmentName: string
  sport: string
  error?: string
  values?: Record<string, string>
}) => {
  const { code, assessmentName, sport, error = '', values = {} } = args
  const v = (name: string) => escapeHTML(values[name] || '')
  const sportName = sport || 'Hockey'
  const positions = getPositionsForSport(sportName)
  const levels = SPORT_LEVELS[sportName] || SPORT_LEVELS.Hockey!

  const positionOptions = positions
    .map(
      (p) =>
        `<option value="${escapeHTML(p)}" ${values.positionTryingOutFor === p ? 'selected' : ''}>${escapeHTML(p)}</option>`
    )
    .join('\n                ')

  const levelOptions = levels
    .map(
      (l) =>
        `<option value="${escapeHTML(l.value)}" ${values.currentLevel === l.value ? 'selected' : ''}>${escapeHTML(l.label)}</option>`
    )
    .join('\n                ')

  const waiverChecked = values.waiver === 'yes'

  return page(
    `Player Registration - ${assessmentName || code}`,
    `
      <div class="card">
        <div class="qrHeader">
          <img src="/assets/tryout-main-logo-optimized.webp" alt="Tryout" onerror="this.style.display='none'" />
        </div>
        <p class="muted">Assessment: <b>${escapeHTML(assessmentName || 'Assessment')}</b> (${escapeHTML(code)})</p>
        ${error ? `<div class="banner error">${escapeHTML(error)}</div>` : ''}
        <form method="POST" action="/assessment/${encodeURIComponent(code)}/register">
          <h2>Player Info</h2>
          <div class="grid">
            <div>
              <label for="firstName">First Name *</label>
              <input id="firstName" name="firstName" required autocomplete="given-name" value="${v('firstName')}" />
            </div>
            <div>
              <label for="lastName">Last Name *</label>
              <input id="lastName" name="lastName" required autocomplete="family-name" value="${v('lastName')}" />
            </div>
          </div>

          <div class="grid">
            <div>
              <label for="yearOfBirth">Year of Birth *</label>
              <select id="yearOfBirth" name="yearOfBirth" required>
                <option value="">Select year...</option>
                ${Array.from({ length: new Date().getFullYear() - 1925 + 1 }, (_, i) => {
                  const yr = new Date().getFullYear() - i
                  const selected = v('yearOfBirth') === String(yr) ? 'selected' : ''
                  return `<option value="${yr}" ${selected}>${yr}</option>`
                }).join('')}
              </select>
            </div>
            <div>
              <label for="currentTeam">Current ${escapeHTML(sportName)} Team <span class="opt">(optional)</span></label>
              <input id="currentTeam" name="currentTeam" value="${v('currentTeam')}" />
            </div>
          </div>

          <div class="grid">
            <div>
              <label for="currentLevel">Current ${escapeHTML(sportName)} Level <span class="opt">(optional)</span></label>
              <select id="currentLevel" name="currentLevel">
                <option value="" ${!values.currentLevel ? 'selected' : ''}>Select level...</option>
                ${levelOptions}
              </select>
            </div>
            <div>
              <label for="positionTryingOutFor">Position Trying Out For <span class="opt">(optional)</span></label>
              <select id="positionTryingOutFor" name="positionTryingOutFor">
                <option value="" ${!values.positionTryingOutFor ? 'selected' : ''}>Select position...</option>
                ${positionOptions}
              </select>
            </div>
          </div>

          <label for="aboutChild">Tell Us About the Player <span class="opt">(optional)</span></label>
          <textarea id="aboutChild" name="aboutChild" placeholder="Hobbies, other sports, interests, anything else we should know...">${v('aboutChild')}</textarea>

          <div class="medBox">
            <h2>Medical Information <span class="opt">(optional)</span></h2>
            <textarea id="medicalInfo" name="medicalInfo" style="min-height:70px;" placeholder="Any allergies, conditions, medications, or other medical details evaluators should be aware of...">${v('medicalInfo')}</textarea>
          </div>

          <h2 style="margin-top:18px;">Parent / Guardian Contact</h2>
          <div class="grid">
            <div>
              <label for="guardianName">Parent / Guardian Name *</label>
              <input id="guardianName" name="guardianName" required autocomplete="name" value="${v('guardianName')}" />
            </div>
            <div>
              <label for="guardianPhone">Phone Number *</label>
              <input id="guardianPhone" name="guardianPhone" type="tel" required autocomplete="tel" value="${v('guardianPhone')}" />
            </div>
          </div>
          <label for="guardianEmail">Email Address *</label>
          <input id="guardianEmail" name="guardianEmail" type="email" required autocomplete="email" value="${v('guardianEmail')}" />

          <div class="friendBox">
            <h2>Friend Requests <span class="opt">(optional)</span></h2>
            <p class="muted" style="margin:0 0 10px;font-size:.88rem;">Name up to 2 friends you would like to be placed on the same team with during the sort.</p>
            <div class="grid">
              <div>
                <label for="friend1Name">Friend 1 — Full Name</label>
                <input id="friend1Name" name="friend1Name" placeholder="e.g. Jordan Smith" value="${v('friend1Name')}" />
              </div>
              <div>
                <label for="friend2Name">Friend 2 — Full Name</label>
                <input id="friend2Name" name="friend2Name" placeholder="e.g. Taylor Jones" value="${v('friend2Name')}" />
              </div>
            </div>
          </div>

          <div id="authRow" class="authRow ${waiverChecked ? 'authorized' : ''}" style="margin-top:18px;">
            <input type="checkbox" id="waiver" name="waiver" value="yes" ${waiverChecked ? 'checked' : ''} required
              onchange="const row=document.getElementById('authRow');row.classList.toggle('authorized',this.checked);" />
            <span class="authCheckMark">&#10003;</span>
            <label for="waiver" style="font-weight:700;margin:0;cursor:pointer;">
              Authorization *
              <span style="display:block;font-weight:400;font-size:.9rem;color:#315269;margin-top:2px;">I consent to recording this child&apos;s information for assessment purposes only.</span>
            </label>
          </div>

          <div style="margin:18px 0 10px;padding:14px 16px;background:#fff7ed;border:2px solid #f97316;border-radius:10px;display:flex;align-items:center;gap:14px;">
            <input type="checkbox" id="sortOut" name="sortOut" value="yes" ${values.sortOut === 'yes' ? 'checked' : ''} style="width:22px;height:22px;accent-color:#f97316;flex-shrink:0;" />
            <label for="sortOut" style="font-weight:800;font-size:1rem;color:#c2410c;cursor:pointer;margin:0;">
              Sort Out — Include me in the team sort
              <span style="display:block;font-weight:400;font-size:0.85rem;color:#92400e;margin-top:2px;">Check this if you are participating in the team sort-out process</span>
            </label>
          </div>

          <button type="submit">Submit Registration</button>
        </form>
      </div>
    `
  )
}

const registrationSuccessHTML = (args: {
  code: string
  assessmentName: string
  playerName: string
  guardianEmail: string
  emailSent: boolean
}) =>
  page(
    'Registration Complete',
    `
      <div class="card">
        <div class="banner">Registration successful. ${escapeHTML(
          args.playerName
        )} has been added to the roster.</div>
        <h1>Thank You</h1>
        <p class="meta">Assessment: <b>${escapeHTML(args.assessmentName || 'Assessment')}</b> (${escapeHTML(
          args.code
        )})</p>
        <p>The player profile was submitted and is now available in the assessment roster.</p>
        ${
          args.emailSent
            ? `<p class="meta" style="color:#0f5c33;">A confirmation email has been sent to <b>${escapeHTML(args.guardianEmail)}</b>.</p>`
            : `<p class="meta">Your registration has been recorded. Please save this page as your confirmation.</p>`
        }
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:12px;">
          <p style="margin:0 0 4px;font-weight:700;font-size:.9rem;color:#475569;">Registration Details</p>
          <p style="margin:0;font-size:.9rem;color:#64748b;">Player: ${escapeHTML(args.playerName)}</p>
          <p style="margin:0;font-size:.9rem;color:#64748b;">Assessment: ${escapeHTML(args.assessmentName)}</p>
          <p style="margin:0;font-size:.9rem;color:#64748b;">Code: ${escapeHTML(args.code)}</p>
          <p style="margin:0;font-size:.9rem;color:#64748b;">Contact: ${escapeHTML(args.guardianEmail)}</p>
        </div>
      </div>
    `
  )

const renderNotFound = (code: string) =>
  new Response(
    page(
      'Assessment Not Found',
      `<div class="card"><h1>Assessment not found</h1><p class="muted">Code: ${escapeHTML(
        code
      )}</p></div>`
    ),
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )

const generateId = () => {
  const bytes = new Uint8Array(12)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Generates a unique 8-digit numeric Athlete ID for year-over-year tracking
const generateAthleteId = () =>
  String(Math.floor(10000000 + Math.random() * 90000000))

const getBaseUrl = (req: Request) => {
  const forwarded = req.headers.get('x-forwarded-host')
  const host = forwarded || req.headers.get('host') || new URL(req.url).host
  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '')
  return `${proto}://${host}`
}

const loadAssessment = async (code: string) => {
  const stored = await cloudStore().get(code, { type: 'json' })
  if (!stored || typeof stored !== 'object') return null
  return stored as Record<string, unknown>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const rosterIncludesPlayer = (assessment: Record<string, unknown> | null, playerId: string) => {
  if (!assessment || !playerId) return false
  const roster = Array.isArray(assessment.roster) ? assessment.roster : []
  return roster.some(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      String((entry as Record<string, unknown>).id || '').trim() === playerId
  )
}

const verifyPlayerInRoster = async (code: string, playerId: string) => {
  for (let attempt = 0; attempt < VERIFY_RETRY_COUNT; attempt += 1) {
    const current = await loadAssessment(code)
    if (rosterIncludesPlayer(current, playerId)) return true
    if (attempt < VERIFY_RETRY_COUNT - 1) {
      await sleep(VERIFY_RETRY_DELAY_MS)
    }
  }
  return false
}

const appendPlayerToRoster = async (code: string, player: Record<string, unknown>) => {
  const playerId = String(player.id || '').trim()
  if (!playerId) return { ok: false, notFound: false }

  for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt += 1) {
    let currentEntry: { data: unknown; etag?: string } | null = null
    try {
      currentEntry = await cloudStore().getWithMetadata(code, { type: 'json' })
    } catch {
      if (attempt < MAX_WRITE_RETRIES - 1) continue
      return { ok: false, notFound: true }
    }

    if (!currentEntry || !currentEntry.data || typeof currentEntry.data !== 'object') {
      return { ok: false, notFound: true }
    }

    const assessment = currentEntry.data as Record<string, unknown>
    const roster = Array.isArray(assessment.roster) ? [...assessment.roster] : []

    const exists = roster.some(
      (entry) => String((entry as Record<string, unknown>)?.id || '').trim() === playerId
    )
    if (exists) {
      // Player already in roster (possibly from a previous attempt) — treat as success
      return { ok: true, notFound: false }
    }

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

    const body = JSON.stringify(next)

    try {
      if (currentEntry.etag) {
        // Conditional write: only succeeds if blob hasn't changed since we read it
        const result = await cloudStore().set(code, body, {
          metadata: { contentType: 'application/json' },
          onlyIfMatch: currentEntry.etag,
        })
        // result.modified is false when ETag didn't match (concurrent update)
        if (result && result.modified === false) {
          // Conflict — retry with fresh read
          continue
        }
      } else {
        // No ETag available — unconditional write (set returns void)
        await cloudStore().set(code, body, {
          metadata: { contentType: 'application/json' },
        })
      }

      // Write succeeded (either conditional with modified=true, or unconditional void).
      // Verify the player actually appears in the roster to catch edge cases.
      const verified = await verifyPlayerInRoster(code, playerId)
      if (verified) return { ok: true, notFound: false }

      // Verification failed — another write may have overwritten ours. Retry.
      if (attempt >= MAX_WRITE_RETRIES - 1) return { ok: false, notFound: false }
    } catch {
      if (attempt >= MAX_WRITE_RETRIES - 1) return { ok: false, notFound: false }
    }
  }

  return { ok: false, notFound: false }
}

const extractCodeFromPath = (pathname: string) => {
  const match = pathname.match(/^\/assessment\/([^/]+)\//)
  return match ? decodeURIComponent(match[1]) : ''
}

// ---- Email confirmation ----

const sendConfirmationEmail = async (args: {
  to: string
  playerName: string
  assessmentName: string
  code: string
  sport: string
  position: string
  level: string
  guardianName: string
  baseUrl: string
}) => {
  const sendgridKey = Netlify.env.get('SENDGRID_API_KEY') || ''
  const resendKey = Netlify.env.get('RESEND_API_KEY') || ''
  const fromEmail = Netlify.env.get('REGISTRATION_EMAIL_FROM') || 'noreply@athleteassessmentsystems.com'
  const fromName = Netlify.env.get('REGISTRATION_EMAIL_FROM_NAME') || 'Athlete Assessment Systems'

  const subject = `Registration Confirmed - ${args.assessmentName}`

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f3f7ff;">
  <div style="max-width:600px;margin:0 auto;padding:30px 16px;">
    <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #d9e6ea;">
      <h1 style="color:#17324a;font-size:22px;margin:0 0 8px;">Registration Confirmed</h1>
      <p style="color:#5a6f7f;margin:0 0 20px;font-size:15px;">
        ${escapeHTML(args.assessmentName)} (${escapeHTML(args.code)})
      </p>
      <div style="background:#e9fff3;border:1px solid #9ee7be;border-radius:8px;padding:12px;margin:0 0 18px;">
        <strong style="color:#0f5c33;">${escapeHTML(args.playerName)}</strong>
        <span style="color:#0f5c33;"> has been successfully registered.</span>
      </div>
      <table style="width:100%;font-size:14px;color:#315269;border-collapse:collapse;">
        <tr><td style="padding:6px 0;font-weight:700;">Player</td><td style="padding:6px 0;">${escapeHTML(args.playerName)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:700;">Sport</td><td style="padding:6px 0;">${escapeHTML(args.sport)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:700;">Position</td><td style="padding:6px 0;">${escapeHTML(args.position)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:700;">Level</td><td style="padding:6px 0;">${escapeHTML(args.level)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:700;">Guardian</td><td style="padding:6px 0;">${escapeHTML(args.guardianName)}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0;" />
      <p style="color:#5a6f7f;font-size:13px;margin:0;">
        This is an automated confirmation from Athlete Assessment Systems.
        If you did not register for this assessment, please disregard this email.
      </p>
    </div>
  </div>
</body>
</html>`

  const textBody = `Registration Confirmed

${args.playerName} has been successfully registered for ${args.assessmentName} (${args.code}).

Player: ${args.playerName}
Sport: ${args.sport}
Position: ${args.position}
Level: ${args.level}
Guardian: ${args.guardianName}

This is an automated confirmation from Athlete Assessment Systems.`

  // Try SendGrid first
  if (sendgridKey) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
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
      console.error('[registration-email] SendGrid send failed:', err instanceof Error ? err.message : err)
      return false
    }
  }

  // Try Resend
  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [args.to],
          subject,
          html: htmlBody,
          text: textBody,
        }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        console.error(`[registration-email] Resend returned ${res.status}: ${detail}`)
      }
      return res.ok
    } catch (err) {
      console.error('[registration-email] Resend send failed:', err instanceof Error ? err.message : err)
      return false
    }
  }

  // No email provider configured
  console.warn('[registration-email] No email provider configured. Set SENDGRID_API_KEY or RESEND_API_KEY environment variable to enable confirmation emails.')
  return false
}

// ---- Main handler ----

export default async (req: Request, context: Context) => {
  const path = new URL(req.url).pathname
  const code = normalizeCode(context.params?.code) || normalizeCode(extractCodeFromPath(path))
  if (!code || !CODE_PATTERN.test(code)) {
    return new Response('Invalid assessment code.', { status: 400 })
  }

  let assessment: Record<string, unknown> | null = null
  try {
    assessment = await loadAssessment(code)
  } catch (error) {
    if (isBlobsNotConfigured(error)) {
      return new Response('Cloud storage is not configured.', { status: 503 })
    }
    return new Response('Cloud storage error.', { status: 500 })
  }

  if (!assessment) return renderNotFound(code)
  const assessmentName = String(assessment.name || 'Assessment')
  const sport = getSportName(assessment)
  const registerPath = `/assessment/${encodeURIComponent(code)}/register`
  const eventType = String(assessment.eventType || 'assessment').toLowerCase().replace(/\s+/g, '')
  const registerUrl = `${getBaseUrl(req)}/register?event=${encodeURIComponent(code)}&type=${encodeURIComponent(eventType)}`

  // ---- QR Code SVG ----
  if (path.endsWith('/qr.svg')) {
    const svg = await QRCode.toString(registerUrl, {
      type: 'svg',
      margin: 2,
      width: 600,
      errorCorrectionLevel: 'H',
    })
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }

  // ---- Printable QR page ----
  if (path.endsWith('/qr-print')) {
    const svg = await QRCode.toString(registerUrl, {
      type: 'svg',
      margin: 2,
      width: 800,
      errorCorrectionLevel: 'H',
    })
    return new Response(
      page(
        `Registration QR - ${assessmentName}`,
        `
          <div class="card" style="text-align:center;">
            <div style="display:flex;justify-content:center;margin-bottom:10px;">
              <img src="/assets/tryout-main-logo-optimized.webp" alt="Tryout" style="height:48px;width:auto;" onerror="this.style.display='none'" />
            </div>
            <h1 style="margin:0 0 4px;">${escapeHTML(assessmentName)}</h1>
            <p class="muted">Scan to register for this assessment</p>
            <div style="display:flex;justify-content:center;margin:12px 0;">${svg}</div>
            <p class="meta">${escapeHTML(registerUrl)}</p>
          </div>
          <script>window.onload = function(){ window.print(); };</script>
        `
      ),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  // ---- Registration form (GET) ----
  if (path.endsWith('/register') && req.method === 'GET') {
    return new Response(registrationFormHTML({ code, assessmentName, sport }), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // ---- Registration form (POST) ----
  if (path.endsWith('/register') && req.method === 'POST') {
    const form = await req.formData().catch(() => null)
    if (!form) {
      return new Response(registrationFormHTML({ code, assessmentName, sport, error: 'Invalid form submission.' }), {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    const values: Record<string, string> = {
      firstName: String(form.get('firstName') || '').trim(),
      lastName: String(form.get('lastName') || '').trim(),
      yearOfBirth: String(form.get('yearOfBirth') || '').trim(),
      currentTeam: String(form.get('currentTeam') || '').trim(),
      currentLevel: String(form.get('currentLevel') || '').trim(),
      positionTryingOutFor: String(form.get('positionTryingOutFor') || '').trim(),
      guardianName: String(form.get('guardianName') || '').trim(),
      guardianEmail: String(form.get('guardianEmail') || '').trim(),
      guardianPhone: String(form.get('guardianPhone') || '').trim(),
      aboutChild: String(form.get('aboutChild') || '').trim(),
      medicalInfo: String(form.get('medicalInfo') || '').trim(),
      friend1Name: String(form.get('friend1Name') || '').trim(),
      friend2Name: String(form.get('friend2Name') || '').trim(),
      waiver: String(form.get('waiver') || '').trim(),
      sortOut: String(form.get('sortOut') || '').trim(),
    }

    if (!values.firstName || !values.lastName || !values.yearOfBirth || !values.guardianName || !values.guardianEmail || !values.guardianPhone) {
      return new Response(
        registrationFormHTML({
          code,
          assessmentName,
          sport,
          error: 'First Name, Last Name, Year of Birth, and Parent/Guardian name, email, and phone are required.',
          values,
        }),
        { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    const year = Number(values.yearOfBirth)
    const currentYear = new Date().getFullYear()
    if (!Number.isInteger(year) || year < 1925 || year > currentYear) {
      return new Response(
        registrationFormHTML({
          code,
          assessmentName,
          sport,
          error: 'Year of Birth must be between 1950 and the current year.',
          values,
        }),
        { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    if (values.waiver !== 'yes') {
      return new Response(
        registrationFormHTML({
          code,
          assessmentName,
          sport,
          error: 'Waiver consent is required before submitting.',
          values,
        }),
        { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    const createdAt = Date.now()
    const player = {
      id: generateId(),
      athleteId: generateAthleteId(),
      first: values.firstName,
      last: values.lastName,
      anonymous: false,
      jersey: '',
      pos: values.positionTryingOutFor || '',
      shoots: '',
      assignedAssessor: '',
      guardianName: values.guardianName,
      guardianEmail: values.guardianEmail,
      guardianPhone: values.guardianPhone,
      yearOfBirth: values.yearOfBirth,
      currentPosition: values.positionTryingOutFor,
      currentTeam: values.currentTeam,
      currentLevel: values.currentLevel,
      positionTryingOutFor: values.positionTryingOutFor,
      aboutChild: values.aboutChild,
      medicalInfo: values.medicalInfo,
      friend1Name: values.friend1Name,
      friend2Name: values.friend2Name,
      sortOut: values.sortOut === 'yes',
      waiverAcceptedAt: createdAt,
      registrationSource: 'qr',
      createdAt,
      updatedAt: createdAt,
    }

    try {
      const write = await appendPlayerToRoster(code, player)
      if (write.notFound) return renderNotFound(code)
      if (!write.ok) {
        return new Response(
          registrationFormHTML({
            code,
            assessmentName,
            sport,
            error: 'Registration could not be saved due to a temporary conflict. Please try submitting again.',
            values,
          }),
          { status: 409, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      }
    } catch (error) {
      if (isBlobsNotConfigured(error)) {
        return new Response('Cloud storage is not configured.', { status: 503 })
      }
      return new Response(
        registrationFormHTML({
          code,
          assessmentName,
          sport,
          error: 'An unexpected error occurred. Please try again.',
          values,
        }),
        { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    // Send confirmation email (best-effort, don't block on failure)
    const playerName = `${values.firstName} ${values.lastName}`.trim()
    let emailSent = false
    try {
      emailSent = await sendConfirmationEmail({
        to: values.guardianEmail,
        playerName,
        assessmentName,
        code,
        sport,
        position: values.positionTryingOutFor,
        level: values.currentLevel,
        guardianName: values.guardianName,
        baseUrl: getBaseUrl(req),
      })
    } catch (err) {
      console.error('[registration-email] Unexpected error:', err instanceof Error ? err.message : err)
    }

    // Store email record in the blob so the assessor app can see registration details
    // and retry if needed. This is non-blocking.
    try {
      const emailRecord = {
        playerId: player.id,
        to: values.guardianEmail,
        playerName,
        assessmentName,
        code,
        sport,
        position: values.positionTryingOutFor,
        level: values.currentLevel,
        guardianName: values.guardianName,
        sent: emailSent,
        createdAt: Date.now(),
      }
      const emailStoreKey = `${code}:emails`
      const existingEmails = await cloudStore().get(emailStoreKey, { type: 'json' }).catch(() => null)
      const emails = Array.isArray(existingEmails) ? existingEmails : []
      emails.push(emailRecord)
      await cloudStore().set(emailStoreKey, JSON.stringify(emails), {
        metadata: { contentType: 'application/json' },
      })
    } catch {
      // Email record storage is non-critical
    }

    return new Response(
      registrationSuccessHTML({
        code,
        assessmentName,
        playerName,
        guardianEmail: values.guardianEmail,
        emailSent,
      }),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  return new Response('Method not allowed.', { status: 405 })
}

export const config: Config = {
  path: ['/assessment/:code/register', '/assessment/:code/qr.svg', '/assessment/:code/qr-print'],
  method: ['GET', 'POST'],
}
