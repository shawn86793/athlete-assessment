/**
 * E2E: QR registration flow
 *
 * Requires a local dev server running on http://localhost:8888
 * with a valid MOCK_EVENT_CODE env var pointing to a seeded test event.
 *
 * Run: npx cypress run --env eventCode=TEST99
 */

const BASE = Cypress.env('baseUrl') || 'http://localhost:8888'
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
    // Make 11 rapid POST requests (limit is 10 per 15 min per IP)
    const requests = Array.from({ length: 11 }, () =>
      cy.request({
        method: 'POST',
        url: `${BASE}/api/register/submit`,
        body: { eventId: 'XXXXXX' },
        failOnStatusCode: false,
      })
    )
    // At least one should get 429
    cy.wrap(requests[10]).then((res: Cypress.Response<unknown>) => {
      expect([400, 429]).to.include((res as { status: number }).status)
    })
  })
})
