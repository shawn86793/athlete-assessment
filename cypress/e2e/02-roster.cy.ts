// ── 02 · Roster management ────────────────────────────────────────────────
// Login inside each it block — no beforeEach login (prevents CI deadlocks).
// Max timeout: 10 s. No 200-player test (60 s wait removed).
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const TILE_SEL = '.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]'

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Roster — dummy player generation', () => {

  it('generates 50 dummy players without freezing', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('My Teams', { timeout: 10000 })
    cy.get('body').then($body => {
      if (!$body.find(TILE_SEL).length) {
        cy.log('⚠️  No assessments — skipping')
        return
      }
      cy.get(TILE_SEL).first().click()
      cy.contains(/generate|dummy|test data/i, { timeout: 8000 }).click()
      cy.get('#randSkaterCount').clear().type('50')
      cy.get('#randGoalieCount').clear().type('0')
      cy.contains(/generate players|start/i).click()
      cy.get('#batchGenProgress', { timeout: 5000 }).should('be.visible')
      cy.get('#batchGenProgress', { timeout: 30000 }).should('not.be.visible')
      cy.contains(/generated 50 players/i, { timeout: 5000 }).should('be.visible')
    })
  })

})
