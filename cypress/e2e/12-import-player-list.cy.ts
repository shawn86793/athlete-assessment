// ── 12 · Import Player List ────────────────────────────────────────────────
// Single login per describe; all navigation happens inside one it block where
// possible so Cypress doesn't repeat the auth cycle for every assertion.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

describe('Import Player List', () => {

  let shouldRun = false
  let hasAssessment = false

  beforeEach(() => {
    const email = Cypress.env('COACH_EMAIL')
    const pass  = Cypress.env('COACH_PASSWORD')
    shouldRun = !!(email && pass && pass !== 'YOUR_PASSWORD_HERE')
    if (!shouldRun) return

    cy.loginViaAPI(email, pass)
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    // Navigate into the first assessment if one exists
    cy.get('body').then($body => {
      const tile = $body.find('[onclick*="openTryout"], .teamHubTile')
      if (tile.length) {
        hasAssessment = true
        cy.wrap(tile.first()).click()
        cy.get('#importPlayerListTile', { timeout: 12000 }).should('exist')
      } else {
        hasAssessment = false
      }
    })
  })

  it('tile is visible, Import CSV button is directly accessible, and modal opens/closes', () => {
    if (!shouldRun) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    if (!hasAssessment) {
      cy.log('⚠️  No assessments found — skipping')
      return
    }

    // 1. Tile exists and has correct label
    cy.get('#importPlayerListTile').should('be.visible').and('contain.text', 'Import Player List')
    cy.get('#importPlayerListBtn').should('contain.text', 'Import CSV')

    // 2. Button is reachable WITHOUT opening any overlay
    cy.get('#freshTBOverlay').should('not.exist')
    cy.get('#teamBuilderDashboardOverlay').should('not.exist')
    cy.get('#importPlayerListBtn').should('be.visible')

    // 3. Clicking the button opens the import modal
    cy.get('#importPlayerListBtn').click()
    cy.get('#csvImportModal', { timeout: 8000 }).should('be.visible')
    cy.get('#csvImportModal').should('contain.text', 'Import Players')

    // 4. Modal has a file input or textarea
    cy.get('#csvImportModal').then($modal => {
      const hasFileInput = $modal.find('input[type="file"]').length > 0
      const hasTextArea  = $modal.find('textarea').length > 0
      expect(hasFileInput || hasTextArea, 'Import modal should have a file input or textarea').to.be.true
    })

    // 5. Cancel button closes the modal
    cy.get('#csvImportModal').contains('Cancel').click()
    cy.get('#csvImportModal').should('not.exist')
  })

})
