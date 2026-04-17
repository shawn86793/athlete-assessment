// ── 07 · Page Refresh Behaviour ───────────────────────────────────────────
// Verifies that a manual page refresh (F5 / Ctrl+R) keeps the user logged in
// and does NOT redirect them to the login screen.
//
// Bug fixed: the app was calling netlifyIdentity.logout() on every refresh
// because sessionStorage["AAS_SESSION_ACTIVE"] survived F5 and triggered
// forceReloginOnIdentityInit = true.  Fixed in initApp() — the 10-minute
// visibility-change timer already handles security logout.
//
// Bug fixed (2): renderHome() was showing "Syncing your teams" splash even
// when local data existed, hiding the user's teams after every F5.  Fixed by
// skipping the splash when local data is present in localStorage.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

/**
 * Waits until the app has fully rendered a logged-in state.
 * Accepts either the user's display name or the generic "My Account" widget
 * button — both confirm the Netlify Identity session is live.
 */
const waitForAuthReady = () => {
  // The Netlify Identity widget shows "My Account" (or user name) when logged in.
  // This is the most reliable signal that auth completed.
  cy.get('body', { timeout: 20000 }).should('not.include.text', 'Log in')
  // Also confirm the app root rendered something — not a blank page
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

    // Capture the gotrue session before the reload
    cy.window().then(win => {
      const session = win.localStorage.getItem('gotrue-session')
      expect(session, 'gotrue-session should exist before reload').to.not.be.null
    })

    // Simulate F5
    cy.reload()

    // After refresh: app should still be in an authenticated state
    waitForAuthReady()

    // The login screen should NOT appear
    cy.get('body', { timeout: 12000 }).then($body => {
      expect($body.text()).to.not.include('Enter your email to sign in')
    })

    // The gotrue session should still be in localStorage
    cy.window().then(win => {
      expect(win.localStorage.getItem('gotrue-session'), 'gotrue-session should persist after reload').to.not.be.null
    })
  })

  it('refresh does not clear the auth session from localStorage', () => {
    if (!login()) return

    cy.visit('/')
    waitForAuthReady()

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

  it('refresh lands on home — not on an error or 404 page', () => {
    if (!login()) return

    cy.visit('/')
    waitForAuthReady()

    cy.reload()

    // App root should have content — not blank, no 404, no error banner
    cy.get('#app', { timeout: 15000 }).should('not.be.empty')
    cy.get('body').should('not.contain.text', 'Page Not Found')
    cy.get('body').should('not.contain.text', '404')
    // Should not show a sign-in prompt as the primary content
    cy.get('body').should('not.contain.text', 'Enter your email to sign in')
  })
})
