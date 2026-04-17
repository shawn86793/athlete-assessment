// ── 07 · Page Refresh Behaviour ───────────────────────────────────────────
// Verifies that a manual page refresh (F5 / Ctrl+R) keeps the user logged in
// and does NOT redirect them to the login screen.
//
// Bugs fixed in the app:
//   1. initApp() was calling netlifyIdentity.logout() on every refresh because
//      sessionStorage["AAS_SESSION_ACTIVE"] survived F5 → forceReloginOnIdentityInit=true.
//   2. renderHome() was blocking on a "Syncing your teams" splash even when the
//      user's data was already cached in localStorage, hiding teams after every F5.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

/**
 * Waits until the app has fully rendered a logged-in state.
 * "Sign Out" only appears in the header when a user is authenticated —
 * it is the cleanest positive signal available without touching window internals.
 */
const waitForAuthReady = () => {
  cy.contains('Sign Out', { timeout: 20000 }).should('exist')
  cy.get('#app', { timeout: 15000 }).should('not.be.empty')
}

describe('Page refresh — session persistence', () => {
  it('user stays logged in after a page refresh', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.visit('/')
    waitForAuthReady()

    // Capture gotrue session before reload
    cy.window().then(win => {
      const session = win.localStorage.getItem('gotrue-session')
      expect(session, 'gotrue-session should exist before reload').to.not.be.null
    })

    // Simulate F5
    cy.reload()

    // After refresh: Sign Out must still be present → user is still authenticated
    waitForAuthReady()

    // The sign-in prompt must NOT be the primary content
    cy.get('body', { timeout: 12000 }).then($body => {
      expect($body.text()).to.not.include('Enter your email to sign in')
    })

    // The gotrue session must still be in localStorage
    cy.window().then(win => {
      expect(
        win.localStorage.getItem('gotrue-session'),
        'gotrue-session should persist after reload'
      ).to.not.be.null
    })
  })

  it('refresh does not clear the auth session from localStorage', () => {
    if (!login()) return

    cy.visit('/')
    waitForAuthReady()

    cy.window().then(win => {
      expect(win.localStorage.getItem('gotrue-session')).to.not.be.null
    })

    cy.reload()

    cy.window().then(win => {
      expect(win.localStorage.getItem('gotrue-session')).to.not.be.null
    })
  })

  it('refresh lands on home — not on an error or 404 page', () => {
    if (!login()) return

    cy.visit('/')
    waitForAuthReady()

    cy.reload()

    // App root should have content — not blank
    cy.get('#app', { timeout: 15000 }).should('not.be.empty')
    // Still authenticated — Sign Out is only rendered when a user is logged in
    cy.contains('Sign Out', { timeout: 15000 }).should('exist')
    // URL must still be the home route — not navigated to a 404 or error page
    cy.url().should('not.include', '404')
    cy.url().should('not.include', 'error')
    // Must not show a login prompt as the primary content
    cy.get('body').should('not.contain.text', 'Enter your email to sign in')
  })
})
