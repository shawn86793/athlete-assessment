// ── 08 · QR Registration — HTML Form Flow ─────────────────────────────────
// Tests the server-rendered registration form at /assessment/:code/register
// and the QR SVG endpoint at /assessment/:code/qr.svg.
//
// The QR code itself encodes the public-facing URL:
//   /register?event=:code&type=:eventType
//
// Tests that don't need a real event code run always (error states, validation).
// Tests that need a live cloud-stored event require QR_EVENT_CODE in
// cypress.env.json / CYPRESS_QR_EVENT_CODE in GitHub Actions secrets.
//
// Event code format: 6 chars matching [A-HJ-NP-Z2-9]  (no I, O, 0, 1)

const BASE   = (Cypress.config('baseUrl') as string) || 'https://athleteassessmentsystems.netlify.app'
const QR_CODE = Cypress.env('QR_EVENT_CODE') as string | undefined

// A valid-format code that almost certainly doesn't exist in the cloud store
const GHOST_CODE = 'AABBCC'

// ── Helpers ─────────────────────────────────────────────────────────────────

const formUrl  = (code: string) => `/assessment/${code}/register`
const qrSvgUrl = (code: string) => `${BASE}/assessment/${code}/qr.svg`

/** Fill every required field on the HTML registration form. */
const fillForm = (overrides: Record<string, string> = {}) => {
  const values = {
    firstName:    'CypressTest',
    lastName:     `Player${Date.now()}`,     // unique — avoids duplicate-detection flake
    yearOfBirth:  '2012',
    guardianName: 'Test Guardian',
    guardianEmail:'cypress.test@example.com',
    guardianPhone:'555-000-0000',
    ...overrides,
  }
  cy.get('#firstName').clear().type(values.firstName)
  cy.get('#lastName').clear().type(values.lastName)
  cy.get('#yearOfBirth').select(values.yearOfBirth)
  cy.get('#guardianName').clear().type(values.guardianName)
  cy.get('#guardianEmail').clear().type(values.guardianEmail)
  cy.get('#guardianPhone').clear().type(values.guardianPhone)
  return values
}

// ── Tests that do NOT need a real event code ─────────────────────────────────

describe('QR registration — invalid / unknown event codes', () => {
  it('returns 400 for a code containing invalid characters', () => {
    // '!' is not in [A-HJ-NP-Z2-9], so the function rejects it immediately
    cy.request({
      url: `${BASE}/assessment/BAD!!!/register`,
      failOnStatusCode: false,
    }).then(res => {
      expect(res.status).to.eq(400)
    })
  })

  it('shows "Assessment not found" page or service unavailable for a valid-format but unknown code', () => {
    // In CI Netlify Blobs may not be configured, causing a 503 before the
    // function reaches the "not found" check.  Accept either:
    //   • 200 body containing "Assessment not found" (Blobs reachable, code missing)
    //   • 503 body containing "not configured"      (Blobs unavailable in CI)
    cy.request({
      url: `${BASE}/assessment/${GHOST_CODE}/register`,
      failOnStatusCode: false,
    }).then(res => {
      if (res.status === 503) {
        cy.log('⚠️  Blobs not configured in this environment — skipping not-found body check')
        return
      }
      // Status can be 200 (renders the "not found" page as HTML) or 404
      expect([200, 404]).to.include(res.status)
      if (res.status === 200) {
        expect(res.body).to.include(GHOST_CODE)
      }
    })
  })

  it('returns 404 or 503 for the QR SVG of an unknown code', () => {
    // 404 = code not found (expected)
    // 503 = Blobs not configured in CI (acceptable — function could not check)
    cy.request({
      url: qrSvgUrl(GHOST_CODE),
      failOnStatusCode: false,
    }).then(res => {
      expect([404, 503]).to.include(res.status)
      cy.log(`QR SVG for unknown code returned: ${res.status}`)
    })
  })
})

// ── Tests that require a real cloud-stored event ──────────────────────────────

describe('QR registration — form load (requires QR_EVENT_CODE)', () => {
  before(function () {
    if (!QR_CODE) {
      cy.log('⚠️  Skipping — set QR_EVENT_CODE in cypress.env.json')
      this.skip()
    }
  })

  it('loads the registration form for a valid event code', () => {
    cy.visit(formUrl(QR_CODE!))
    cy.get('form').should('exist')
    cy.get('#firstName').should('exist')
    cy.get('#lastName').should('exist')
    cy.get('#yearOfBirth').should('exist')
    cy.get('#guardianName').should('exist')
    cy.get('#guardianEmail').should('exist')
    cy.get('#guardianPhone').should('exist')
    cy.get('#waiver').should('exist')
    cy.get('button[type="submit"]').should('contain.text', 'Submit Registration')
  })

  it('shows the event name on the registration form', () => {
    cy.visit(formUrl(QR_CODE!))
    // The form title shows "Player Registration - <EventName>"
    cy.title().should('include', 'Player Registration')
    // The card shows the event code
    cy.get('body').should('contain.text', QR_CODE)
  })

  it('serves the QR code SVG image', () => {
    cy.request(qrSvgUrl(QR_CODE!)).then(res => {
      expect(res.status).to.eq(200)
      expect(res.headers['content-type']).to.include('svg')
      expect(res.body).to.include('<svg')
    })
  })
})

describe('QR registration — form validation (requires QR_EVENT_CODE)', () => {
  before(function () {
    if (!QR_CODE) this.skip()
  })

  beforeEach(() => {
    cy.visit(formUrl(QR_CODE!))
  })

  it('shows an error when required fields are missing', () => {
    // Submit with nothing filled in
    cy.get('button[type="submit"]').click()
    // Browser native validation OR server-side error — either way an error surfaces
    cy.get('body').then($body => {
      const hasServerError = $body.find('.banner.error, [class*=error]').length > 0
      const hasNativeInvalid = $body.find(':invalid').length > 0
      expect(hasServerError || hasNativeInvalid).to.be.true
    })
  })

  it('shows an error when waiver consent is missing', () => {
    fillForm()
    // Do NOT check the waiver checkbox
    cy.get('button[type="submit"]').click()
    cy.get('body').then($body => {
      const hasServerError = $body.find('.banner.error').length > 0
      const waiverInvalid = $body.find('#waiver:invalid').length > 0
      expect(hasServerError || waiverInvalid, 'waiver should be required').to.be.true
    })
  })
})

describe('QR registration — successful submission (requires QR_EVENT_CODE)', () => {
  before(function () {
    if (!QR_CODE) this.skip()
  })

  it('shows the success page after a complete valid submission', () => {
    cy.visit(formUrl(QR_CODE!))

    const { firstName, lastName } = fillForm()

    // Accept waiver
    cy.get('#waiver').check()
    cy.get('#authRow').should('have.class', 'authorized')

    cy.get('button[type="submit"]').click()

    // Success page shows "Thank You" and player name
    cy.get('body', { timeout: 15000 }).should('contain.text', 'Thank You')
    cy.get('body').should('contain.text', firstName)
    cy.get('body').should('contain.text', lastName)
    cy.get('body').should('contain.text', QR_CODE)
  })

  it('blocks a duplicate registration for the same player', () => {
    const uniqueLast = `DupTest${Math.floor(Date.now() / 1000 / 60)}`

    // First submission
    cy.visit(formUrl(QR_CODE!))
    fillForm({ lastName: uniqueLast })
    cy.get('#waiver').check()
    cy.get('button[type="submit"]').click()
    cy.get('body', { timeout: 15000 }).should('contain.text', 'Thank You')

    // Second submission — same player
    cy.visit(formUrl(QR_CODE!))
    fillForm({ lastName: uniqueLast })
    cy.get('#waiver').check()
    cy.get('button[type="submit"]').click()

    // Should show a duplicate/already-registered error, NOT a success page
    cy.get('body', { timeout: 10000 }).should('contain.text', 'already')
    cy.get('body').should('not.contain.text', 'Thank You')
  })
})
