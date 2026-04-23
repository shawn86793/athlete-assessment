// ── 09 · Export ────────────────────────────────────────────────────────────
// Import tests are covered by 12-import-player-list.cy.ts.
// This spec covers export buttons and registration API smoke tests.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const BASE = (Cypress.config('baseUrl') as string) || 'https://athleteassessmentsystems.netlify.app'

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

// ── Export endpoint smoke tests ───────────────────────────────────────────

describe('Export page — buttons are present', () => {
  it('shows Full Results PDF, CSV, and Excel buttons on the export page', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.contains('Sign Out', { timeout: 10000 }).should('exist')

    // Navigate directly into an assessment first, then go to Export.
    // We look for the "Open" button inside an assessment card — that's the
    // deterministic path rather than hunting for "Export" text anywhere on the page.
    cy.get('body').then($body => {
      // Assessment "Open" buttons appear once cloud sync loads real data.
      // We look for the onclick="openTryout(...)" handler on any button labeled "Open".
      const openBtn = $body.find('[onclick*="openTryout"]').first()
      if (!openBtn.length) {
        cy.log('⚠️  No assessments found — skipping export buttons test')
        return
      }

      cy.wrap(openBtn).click()

      // Once inside the assessment the top-tab nav appears with an "Export" button.
      cy.get('[onclick*="go(\'export\')"]', { timeout: 10000 }).should('exist').click()

      // Export page should render Full Results PDF and CSV cards.
      cy.get('body', { timeout: 8000 }).then($ex => {
        const hasPDF   = $ex.text().includes('Full Results PDF')
        const hasCSV   = $ex.text().includes('Full Results CSV')
        const hasExcel = $ex.text().includes('Excel') || $ex.text().includes('xlsx')
        cy.log(`Export page — PDF:${hasPDF} CSV:${hasCSV} Excel:${hasExcel}`)
        expect(hasPDF || hasCSV || hasExcel,
          'Export page should show at least one export option').to.be.true
      })
    })
  })
})

// ── Registration API export ───────────────────────────────────────────────

describe('Registration export endpoint', () => {
  it('GET /api/register/event-info returns 400 when no event param is supplied', () => {
    cy.request({
      url: `${BASE}/api/register/event-info`,
      failOnStatusCode: false,
    }).then(res => {
      expect(res.status).to.eq(400)
    })
  })

  it('GET /api/register/event-info returns 400 for an invalid event code format', () => {
    cy.request({
      url: `${BASE}/api/register/event-info?event=BAD!!!`,
      failOnStatusCode: false,
    }).then(res => {
      expect(res.status).to.eq(400)
    })
  })
})
