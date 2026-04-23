// ── 07 · Page Refresh Behaviour ───────────────────────────────────────────
// Verifies a hard reload keeps the user logged in and lands on home.
// 3 tests consolidated into 1. Max timeout: 10 s.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Page refresh — session persistence', () => {
  it('session persists, app stays on home, no 404 after reload', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.contains('Sign Out', { timeout: 10000 }).should('exist')

    // gotrue-session must exist before reload
    cy.window().then(win => {
      expect(win.localStorage.getItem('gotrue-session'), 'session before reload').to.not.be.null
    })

    cy.reload()

    // App has content, stays on home, no error or login page
    cy.get('#app', { timeout: 10000 }).should('not.be.empty')
    cy.url().should('not.include', '404')
    cy.url().should('not.include', 'error')
    cy.get('body').should('not.contain.text', 'Enter your email to sign in')

    // gotrue-session still present after reload
    cy.window().then(win => {
      expect(win.localStorage.getItem('gotrue-session'), 'session after reload').to.not.be.null
    })
  })
})
