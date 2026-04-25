// ── 01 · Authentication ────────────────────────────────────────────────────
// Runs first. loginViaAPI uses real credentials when COACH_EMAIL +
// COACH_PASSWORD are set in cypress.env.json, otherwise falls back to a
// synthetic session so UI-flow tests always run.

describe('Authentication', () => {
  beforeEach(() => {
    cy.clearAppState()
  })

  it('shows the login screen when not signed in', () => {
    // Clear the live site's localStorage here (beforeEach clears the wrong
    // origin — about:blank — because the AUT hasn't navigated yet).
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.clear()
        win.sessionStorage.clear()
      },
    })
    cy.get('[data-netlify-identity-button], .netlify-identity-button, button', { timeout: 8000 })
      .should('exist')
    cy.get('#homeScreen, #mainContent, .homeContainer', { timeout: 5000 })
      .should('not.exist')
  })

  it('signs in and lands on the home dashboard', () => {
    const email = Cypress.env('COACH_EMAIL') || 'cypress@example.com'
    const pass  = Cypress.env('COACH_PASSWORD') || ''
    cy.loginViaAPI(email, pass)
    // App renders home — either "Sign Out" button or #app with content
    cy.get('#app', { timeout: 12000 }).should('not.be.empty')
    cy.contains(/sign out|my teams/i, { timeout: 10000 }).should('exist')
  })
})
