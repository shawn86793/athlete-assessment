// ── 09 · Import & Export ───────────────────────────────────────────────────
// Merged from 09-import-export and 12-import-player-list.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const BASE = (Cypress.config('baseUrl') as string) || 'https://athleteassessmentsystems.netlify.app'

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Import & Export', () => {

  it('Import CSV tile visible, modal opens and closes', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 10000 }).should('exist')
    cy.get('body').then($body => {
      const tile = $body.find('[onclick*="openTryout"], .teamHubTile').first()
      if (!tile.length) { cy.log('⚠️  No assessments — skipping'); return }
      cy.wrap(tile).click()
      cy.get('#importPlayerListTile', { timeout: 10000 }).should('be.visible').and('contain.text', 'Import Player List')
      cy.get('#importPlayerListBtn').should('contain.text', 'Import CSV')
      cy.get('#freshTBOverlay').should('not.exist')
      cy.get('#importPlayerListBtn').click()
      cy.get('#csvImportModal', { timeout: 8000 }).should('be.visible').and('contain.text', 'Import Players')
      cy.get('#csvImportModal').then($m => {
        expect($m.find('input[type="file"]').length + $m.find('textarea').length).to.be.greaterThan(0)
      })
      cy.get('#csvImportModal').contains('Cancel').click()
      cy.get('#csvImportModal').should('not.exist')
    })
  })

  it('Export page shows at least one export option', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 10000 }).should('exist')
    cy.get('body').then($body => {
      const openBtn = $body.find('[onclick*="openTryout"]').first()
      if (!openBtn.length) { cy.log('⚠️  No assessments — skipping'); return }
      cy.wrap(openBtn).click()
      cy.get('[onclick*="go(\'export\')"]', { timeout: 10000 }).click()
      cy.get('body', { timeout: 8000 }).then($ex => {
        const text = $ex.text()
        expect(
          text.includes('Full Results PDF') || text.includes('Full Results CSV') || text.includes('Excel'),
          'Export page shows at least one export option'
        ).to.be.true
      })
    })
  })

  it('GET /api/register/event-info returns 400 for missing or invalid event code', () => {
    cy.request({ url: `${BASE}/api/register/event-info`, failOnStatusCode: false })
      .its('status').should('eq', 400)
    cy.request({ url: `${BASE}/api/register/event-info?event=BAD!!!`, failOnStatusCode: false })
      .its('status').should('eq', 400)
  })

})
