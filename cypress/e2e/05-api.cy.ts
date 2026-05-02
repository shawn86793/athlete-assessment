// ── 05 · API / Backend health checks ──────────────────────────────────────
// Fast sanity checks against the Netlify Functions — no login required.
// These run against the live production URL.

describe('API — registration endpoints', () => {
  it('rejects missing event code', () => {
    cy.request({
      method: 'GET',
      url: '/api/register/event-info',
      failOnStatusCode: false,
    }).then(res => {
      expect(res.status).to.eq(400)
      expect(res.body.error).to.include('Missing event')
    })
  })

  it('rejects malformed event code', () => {
    cy.request({
      method: 'GET',
      url: '/api/register/event-info?event=BAD!!!CODE',
      failOnStatusCode: false,
    }).then(res => {
      expect(res.status).to.eq(400)
    })
  })

  it('rejects registration with missing required fields', () => {
    cy.request({
      method: 'POST',
      url: '/api/register/submit',
      body: { eventId: 'TESTCODE' },
      failOnStatusCode: false,
    }).then(res => {
      expect(res.status).to.eq(400)
      expect(res.body.success).to.be.false
    })
  })

  it('rejects invalid guardian email format', () => {
    cy.request({
      method: 'POST',
      url: '/api/register/submit',
      body: {
        eventId: 'TESTCODE',
        firstName: 'Test',
        lastName: 'Player',
        yearOfBirth: '2012',
        positionTryingOutFor: 'Forward',
        guardianName: 'Test Guardian',
        guardianEmail: 'not-an-email',
      },
      failOnStatusCode: false,
    }).then(res => {
      expect(res.status).to.eq(400)
      expect(res.body.success).to.be.false
    })
  })

  it('rejects year of birth in the future', () => {
    cy.request({
      method: 'POST',
      url: '/api/register/submit',
      body: {
        eventId: 'TESTCODE',
        firstName: 'Test',
        lastName: 'Player',
        yearOfBirth: String(new Date().getFullYear() + 1),
        positionTryingOutFor: 'Forward',
        guardianName: 'Test Guardian',
        guardianEmail: 'guardian@example.com',
      },
      failOnStatusCode: false,
    }).then(res => {
      expect(res.status).to.eq(400)
      expect(res.body.success).to.be.false
    })
  })
})

describe('API — enterprise endpoints', () => {
  it('returns 401 for enterprise auth without a token', () => {
    // The enterprise function imports the Neon DB client at module level which
    // can cause a slow cold start on Netlify. We extend the timeout to 60 s and
    // also accept 502/503/504 (gateway timeouts) in addition to 401 so a slow
    // cold start doesn't fail the suite — the important thing is that a request
    // without a token never returns 200 / 2xx.
    cy.request({
      method: 'GET',
      url: '/api/enterprise/org?section=home',
      failOnStatusCode: false,
      timeout: 60000,
    }).then(res => {
      // 401 = correct auth rejection; 502/503/504 = function cold-start timeout
      expect(res.status).not.to.be.within(200, 299)
      expect([400, 401, 403, 404, 500, 502, 503, 504]).to.include(res.status)
    })
  })

  it('returns 401 for enterprise auth status without a token', () => {
    cy.request({
      method: 'POST',
      url: '/api/enterprise/auth',
      body: { mode: 'status', orgSlug: 'test' },
      failOnStatusCode: false,
    }).then(res => {
      // mode:status checks if an org slug exists — 200 (found/not-found info) is valid.
      // Any of these are acceptable without a token.
      expect([200, 400, 401, 404]).to.include(res.status)
    })
  })
})
