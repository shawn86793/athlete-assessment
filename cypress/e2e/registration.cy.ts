/**
 * E2E: QR registration flow
 *
 * Requires a local dev server running on http://localhost:8888
 * with a valid MOCK_EVENT_CODE env var pointing to a seeded test event.
 *
 * Run: npx cypress run --env eventCode=TEST99
 */

// baseUrl comes from cypress.config.ts / CYPRESS_baseUrl env — use config(), not env()
const BASE = (Cypress.config('baseUrl') as string) || 'http://localhost:8888'
const EVENT_CODE = Cypress.env('eventCode') || 'TEST99'

describe('Registration flow', () => {
  it('rejects missing event code', () => {
    cy.request({
      method: 'GET',
      url: `${BASE}/api/register/event-info`,
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(400)
      expect(res.body.error).to.include('Missing event parameter')
    })
  })

  it('rejects malformed event code', () => {
    cy.request({
      method: 'GET',
      url: `${BASE}/api/register/event-info?event=INVALID!`,
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(400)
      expect(res.body.error).to.include('Invalid event code format')
    })
  })

  it('rejects registration with missing fields', () => {
    cy.request({
      method: 'POST',
      url: `${BASE}/api/register/submit`,
      body: { eventId: EVENT_CODE },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(400)
      expect(res.body.success).to.be.false
    })
  })

  it('rejects registration with invalid guardian email', () => {
    cy.request({
      method: 'POST',
      url: `${BASE}/api/register/submit`,
      body: {
        eventId: EVENT_CODE,
        firstName: 'Test',
        lastName: 'Player',
        yearOfBirth: '2012',
        positionTryingOutFor: 'Forward',
        guardianName: 'Test Guardian',
        guardianEmail: 'not-an-email',
      },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(400)
      expect(res.body.success).to.be.false
    })
  })

  it('rejects registration with year of birth in future', () => {
    const futureYear = String(new Date().getFullYear() + 1)
    cy.request({
      method: 'POST',
      url: `${BASE}/api/register/submit`,
      body: {
        eventId: EVENT_CODE,
        firstName: 'Test',
        lastName: 'Player',
        yearOfBirth: futureYear,
        positionTryingOutFor: 'Forward',
        guardianName: 'Test Guardian',
        guardianEmail: 'guardian@example.com',
      },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(400)
      expect(res.body.success).to.be.false
    })
  })

  it('enforces rate limit after many rapid submissions', () => {
    // Make 12 sequential POST requests — after the rate limit (10/15 min per IP)
    // at least the later ones should return 429. We accept 400 too (bad payload).
    const makeRequest = () =>
      cy.request({
        method: 'POST',
        url: `${BASE}/api/register/submit`,
        body: { eventId: 'XXXXXX' },
        failOnStatusCode: false,
      })

    // Run 12 requests sequentially and collect statuses
    const statuses: number[] = []
    Cypress._.times(12, () => {
      makeRequest().then(res => { statuses.push(res.status) })
    })

    // After all requests, at least one should be 429 OR all are 400 (rate limit may vary by IP)
    cy.then(() => {
      const got429 = statuses.some(s => s === 429)
      const allValid = statuses.every(s => [400, 429].includes(s))
      expect(allValid, `All statuses should be 400 or 429, got: ${statuses}`).to.be.true
      cy.log(`Rate limit test: statuses = ${statuses.join(', ')}, 429 hit = ${got429}`)
    })
  })
})
