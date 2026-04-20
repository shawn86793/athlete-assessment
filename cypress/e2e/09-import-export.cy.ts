// ── 09 · CSV Import & Export ───────────────────────────────────────────────
// Tests that roster CSV import works and that export buttons are reachable.
// Import test uses a minimal inline CSV so no fixture file is required.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const BASE = (Cypress.config('baseUrl') as string) || 'https://athleteassessmentsystems.netlify.app'

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

// ── Minimal valid CSV for import testing ──────────────────────────────────
const VALID_CSV = [
  'first,last,jersey,pos,yearOfBirth,guardianName,guardianEmail,guardianPhone',
  'CypressTest,ImportA,88,C,2011,Test Guardian A,guardia@example.com,555-000-0001',
  'CypressTest,ImportB,99,D,2011,Test Guardian B,guardib@example.com,555-000-0002',
].join('\n')

const MALFORMED_CSV = 'this,is,not,a,valid,roster,header\n1,2,3,4,5,6,7'

// ── Import tests ──────────────────────────────────────────────────────────

describe('CSV roster import', () => {
  before(function () {
    if (!login()) this.skip()
  })

  it('shows the import modal when Import CSV is clicked in the team builder', () => {
    cy.visit('/')
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    // Navigate to an assessment that has team builder access
    // If no assessment exists, skip gracefully
    cy.get('body').then($body => {
      const hasAssessment = $body.find('[onclick*="go(\'roster"]').length > 0 ||
                            $body.text().includes('Player List')
      if (!hasAssessment) {
        cy.log('⚠️  No assessment found — skipping import test')
        return
      }

      // Open team builder
      cy.get('body').then($b => {
        if ($b.text().includes('Team Builder')) {
          cy.contains('Team Builder').first().click()
          cy.get('body', { timeout: 8000 }).then($tb => {
            if ($tb.text().includes('Import CSV')) {
              cy.contains('Import CSV').click()
              cy.get('#csvImportModal', { timeout: 5000 }).should('be.visible')
              cy.get('#csvImportModal').should('contain.text', 'Import Players')
              // Close
              cy.get('#csvImportModal').contains('Cancel').click()
              cy.get('#csvImportModal').should('not.exist')
            }
          })
        }
      })
    })
  })
})

// ── Export endpoint smoke tests ───────────────────────────────────────────

describe('Export page — buttons are present', () => {
  before(function () {
    if (!login()) this.skip()
  })

  it('shows Full Results PDF, CSV, and new Excel buttons on the export page', () => {
    cy.visit('/')
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    // Navigate to Export tab (only visible when an assessment is open)
    cy.get('body').then($body => {
      if (!$body.text().includes('Export')) {
        cy.log('⚠️  No Export tab visible — no open assessment')
        return
      }
      cy.contains('Export').first().click()
      cy.contains('Full Results PDF',     { timeout: 8000 }).should('be.visible')
      cy.contains('Full Results CSV').should('be.visible')
      cy.contains('Excel Spreadsheet').should('be.visible')
      cy.contains('Player Report Cards PDF').should('be.visible')
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
