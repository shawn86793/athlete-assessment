// ── 11 · Manual Page Refresh — Group 1: Home screen survives reload ────────
// Verifies that a hard browser refresh keeps the app on the home screen.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Refresh — home screen survives a manual reload', () => {

  it('Sign Out and My Teams are still visible after cy.reload()', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.contains('My Teams', { timeout: 12000 }).should('be.visible')

    cy.reload()

    cy.contains('Sign Out', { timeout: 8000 }).should('exist')
    cy.contains('My Teams', { timeout: 8000 }).should('be.visible')
  })

  it('team-select screen does not appear after reload — no "Log out" button', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    cy.reload()

    cy.contains('Sign Out', { timeout: 8000 }).should('exist')
    cy.contains('Log out').should('not.exist')
  })

})
