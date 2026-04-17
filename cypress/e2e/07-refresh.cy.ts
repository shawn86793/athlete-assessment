// ── 07 · Page Refresh Behaviour ───────────────────────────────────────────
// Verifies that a manual page refresh (F5 / Ctrl+R) keeps the user logged in
// and on the home screen — not redirected to the login screen.
//
// Bug caught: the app was calling netlifyIdentity.logout() on every refresh
// because sessionStorage["AAS_SESSION_ACTIVE"] survived F5 and triggered
// forceReloginOnIdentityInit = true.  Fixed in initApp().

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Page refresh — session persistence', () => {
  it('user stays logged in after a page refresh', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.visit('/')
    // Confirm we start on the home dashboard
    cy.contains('My Teams', { timeout: 12000 }).should('be.visible')

    // Simulate F5
    cy.reload()

    // After refresh: should still be logged in — home screen visible, no login form
    cy.contains('My Teams', { timeout: 15000 }).should('be.visible')
    cy.get('[data-netlify-identity-button], .netlify-identity-button', { timeout: 5000 })
      .should('not.be.visible')
  })

  it('refresh from home lands back on home — not a different screen', () => {
    if (!login()) return

    cy.visit('/')
    cy.contains('My Teams', { timeout: 12000 }).should('be.visible')

    cy.reload()

    // Home content should be visible — not login, not a 404, not an error
    cy.get('body', { timeout: 15000 }).should('not.contain.text', 'Sign In')
    cy.get('body').should('not.contain.text', '404')
    cy.contains('My Teams', { timeout: 15000 }).should('be.visible')
  })

  it('refresh does not clear the auth session from localStorage', () => {
    if (!login()) return

    cy.visit('/')
    cy.contains('My Teams', { timeout: 12000 })

    // Verify gotrue-session is in localStorage before reload
    cy.window().then(win => {
      expect(win.localStorage.getItem('gotrue-session')).to.not.be.null
    })

    cy.reload()

    // gotrue-session should still be there after reload
    cy.window().then(win => {
      expect(win.localStorage.getItem('gotrue-session')).to.not.be.null
    })
  })
})
