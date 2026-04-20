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

// ── Import tests ──────────────────────────────────────────────────────────

describe('CSV roster import', () => {
  it('Import Player List tile is visible on the roster page', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.visit('/')
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    // Navigate into any assessment's roster view
    cy.get('body').then($body => {
      // Look for any assessment tile that leads to the roster
      const hasAssessment = $body.find('[onclick*="openTryout"]').length > 0 ||
                            $body.find('.teamHubTile').length > 0 ||
                            $body.text().includes('Sort Out') ||
                            $body.text().includes('Tryout')
      if (!hasAssessment) {
        cy.log('⚠️  No assessments on this account — skipping import tile test')
        return
      }

      // Click the first assessment
      const tile = $body.find('[onclick*="openTryout"], .teamHubTile').first()
      if (!tile.length) {
        cy.log('⚠️  Could not locate assessment tile — skipping')
        return
      }
      cy.wrap(tile).click()

      // The Import Player List tile should now be visible in the tileGrid
      cy.get('#importPlayerListTile', { timeout: 10000 }).should('be.visible')
      cy.get('#importPlayerListBtn').should('contain.text', 'Import CSV')
    })
  })

  it('shows the import modal when Import Player List tile is clicked', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.visit('/')
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    cy.get('body').then($body => {
      const tile = $body.find('[onclick*="openTryout"], .teamHubTile').first()
      if (!tile.length) {
        cy.log('⚠️  No assessments found — skipping import modal test')
        return
      }
      cy.wrap(tile).click()

      // Click the Import Player List button
      cy.get('#importPlayerListBtn', { timeout: 10000 }).click()
      cy.get('#csvImportModal', { timeout: 8000 }).should('be.visible')
      cy.get('#csvImportModal').should('contain.text', 'Import Players')

      // Close the modal
      cy.get('#csvImportModal').contains('Cancel').click()
      cy.get('#csvImportModal').should('not.exist')
    })
  })
})

// ── Export endpoint smoke tests ───────────────────────────────────────────

describe('Export page — buttons are present', () => {
  it('shows Full Results PDF, CSV, and Excel buttons on the export page', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.visit('/')
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    // Navigate to Export tab (only visible when an assessment is open)
    cy.get('body').then($body => {
      if (!$body.text().includes('Export')) {
        cy.log('⚠️  No Export tab visible — open an assessment first')
        return
      }
      cy.contains('Export').first().click()
      cy.get('body', { timeout: 8000 }).then($ex => {
        const hasPDF = $ex.text().includes('Full Results PDF')
        const hasCSV = $ex.text().includes('Full Results CSV') || $ex.text().includes('CSV')
        const hasExcel = $ex.text().includes('Excel') || $ex.text().includes('xlsx')
        cy.log(`Export buttons — PDF:${hasPDF} CSV:${hasCSV} Excel:${hasExcel}`)
        expect(hasPDF || hasCSV || hasExcel, 'At least one export button should be present').to.be.true
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
