// ── 03 · Team Builder ─────────────────────────────────────────────────────
// Login inside each it block — no beforeEach login (prevents CI deadlocks).
// 8 tests consolidated to 2. Max timeout: 10 s.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

const TILE = '.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]'

describe('Team Builder Dashboard', () => {

  it('opens, filters players by name and score, and can add a package', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('My Teams', { timeout: 10000 })
    cy.get('body').then($body => {
      if (!$body.find(TILE).length) {
        cy.log('⚠️  No assessments found — skipping')
        return
      }
      cy.get(TILE).first().click()
      cy.contains(/team builder/i, { timeout: 8000 }).click()
      cy.get('#freshTBOverlay', { timeout: 6000 }).should('be.visible')
      cy.contains('⚡ Create Teams').should('be.visible')

      // Filter by name
      cy.get('#ftbPlayerList > div', { timeout: 8000 }).should('have.length.greaterThan', 0)
      cy.get('#ftbSearch').type('a')
      cy.get('#ftbPlayerList > div').each(row => {
        cy.wrap(row).invoke('text').should('match', /a/i)
      })
      cy.get('#ftbSearch').clear()

      // Filter by score slider
      cy.get('#ftbScoreSlider').invoke('val', '3').trigger('input')
      cy.get('#ftbScoreLbl').should('contain', '3.0')
      cy.get('#ftbPlayerCount').invoke('text').should('match', /\d+ of \d+ players/)
      cy.get('#ftbScoreSlider').invoke('val', '0').trigger('input')

      // Add a friend package and assign a player
      cy.contains('+ Add').click()
      cy.get('#ftbPkgList > div', { timeout: 5000 }).should('have.length.greaterThan', 0)
      cy.get('#ftbPkgList > div').first().click()
      cy.get('#ftbPlayerList button[title]').first().click()
      cy.get('#ftbPkgList > div').first().should('contain', '1 player')
    })
  })

  it('builds teams and trades a player between them', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('My Teams', { timeout: 10000 })
    cy.get('body').then($body => {
      if (!$body.find(TILE).length) {
        cy.log('⚠️  No assessments found — skipping')
        return
      }
      cy.get(TILE).first().click()
      cy.contains(/team builder/i, { timeout: 8000 }).click()
      cy.get('#freshTBOverlay', { timeout: 6000 }).should('be.visible')

      cy.get('#ftbTeamCount').clear().type('2')
      cy.get('#ftbSkaters').clear().type('3')
      cy.contains('⚡ Create Teams').click()
      cy.get('#freshTBOverlay').should('not.exist')
      cy.get('#teamBuilderDashboardOverlay', { timeout: 8000 }).should('be.visible')
      cy.contains('Team Builder Dashboard').should('be.visible')

      cy.contains('↔ Trade').first().click()
      cy.get('#tradeModalOverlay', { timeout: 5000 }).should('be.visible')
      cy.contains('Complete Trade ✓').click()
      cy.contains(/trade complete/i, { timeout: 5000 }).should('be.visible')
    })
  })

})
