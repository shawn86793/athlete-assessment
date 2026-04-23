// ── 01 · Authentication ────────────────────────────────────────────────────
// Runs first — loginViaAPI called with fresh session, never deadlocks here.
// Max timeout: 10 s.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

describe('Authentication', () => {
  beforeEach(() => {
    cy.clearAppState()
  })

  it('shows the login screen when not signed in', () => {
    cy.visit('/')
    cy.get('[data-netlify-identity-button], .netlify-identity-button, button', { timeout: 8000 })
      .should('exist')
    cy.get('#homeScreen, #mainContent, .homeContainer', { timeout: 5000 })
      .should('not.exist')
  })

  it('signs in via API and lands on the home dashboard', () => {
    const email = Cypress.env('COACH_EMAIL')
    const pass  = Cypress.env('COACH_PASSWORD')
    if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.loginViaAPI(email, pass)
    cy.contains('Sign Out', { timeout: 10000 }).should('exist')
    cy.get('#app', { timeout: 10000 }).should('not.be.empty')
  })
})
