// ── 01 · Authentication ────────────────────────────────────────────────────
// Tests that login works and the home dashboard renders correctly.
// loginViaAPI stubs window.netlifyIdentity and visits '/' — no second
// cy.visit('/') needed; calling it again trips Cypress after the stub visit.

describe('Authentication', () => {
  beforeEach(() => {
    cy.clearAppState()
  })

  it('shows the login screen when not signed in', () => {
    cy.visit('/')
    // The Netlify Identity widget button should be visible
    cy.get('[data-netlify-identity-button], .netlify-identity-button, button', { timeout: 8000 })
      .should('exist')
    // App should NOT show the main roster/home content
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

    // loginViaAPI stubs netlifyIdentity + visits '/' with session pre-loaded.
    // Do NOT call cy.visit('/') again — the stub is only on the loginViaAPI visit.
    cy.loginViaAPI(email, pass)

    // The stub fires "init" with the user → app renders logged-in home
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.get('#app', { timeout: 15000 }).should('not.be.empty')
  })

  it('shows username from email when full_name is not set', () => {
    const email = Cypress.env('COACH_EMAIL')
    const pass  = Cypress.env('COACH_PASSWORD')
    if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return

    cy.loginViaAPI(email, pass)

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    // Should NOT show raw fallback "Coach" — should show name or email prefix
    cy.get('body').should('not.contain.text', 'Hello, Coach')
  })
})
