// ── 07 · Page Refresh Behaviour ───────────────────────────────────────────
// Verifies that a manual page refresh (F5 / Ctrl+R) keeps the user logged in
// and does NOT redirect them to the login screen.
//
// Bug fixed: the app was calling netlifyIdentity.logout() on every refresh
// because sessionStorage["AAS_SESSION_ACTIVE"] survived F5 and triggered
// forceReloginOnIdentityInit = true.  Fixed in initApp() — the 10-minute
// visibility-change timer already handles security logout.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

/** Returns true once the app has finished its post-auth render pass. */
const waitForAuthReady = () => {
  // The Netlify Identity widget shows the user's name / "My Account" when logged in.
  // This is the most reliable signal that auth completed.
  cy.get('.netlify-identity-menu-btn, [data-netlify-identity-button], button', { timeout: 15000 })
    .should('exist')
  // Also confirm the app root rendered something — not a blank page
  cy.get('#app', { timeout: 10000 }).should('not.be.empty')
}

describe('Page refresh — session persistence', () => {
  it('user stays logged in after a page refresh', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.visit('/')
    waitForAuthReady()

    // Verify we are authenticated before the reload
    cy.window().its('authState').should('exist')
    cy.window().then(win => {
      // @ts-ignore
      expect(win.authState?.user).to.not.be.null
    })

    // Simulate F5
    cy.reload()

    // After refresh: app should still be in an authenticated state
    waitForAuthReady()

    // The login screen should NOT appear
    cy.get('body', { timeout: 12000 }).then($body => {
      // If renderLoginScreen() ran, it puts a login form in #app
      const hasLoginForm = $body.find('form[action*="identity"], #loginForm, .netlify-identity-widget iframe').length > 0
      // The app should not show a "Sign in" prompt as the primary content
      expect($body.text()).to.not.include('Enter your email to sign in')
    })

    // The gotrue session should still be in localStorage
    cy.window().then(win => {
      expect(win.localStorage.getItem('gotrue-session')).to.not.be.null
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
    cy.get('#app', { timeout: 12000 }).should('not.be.empty')
    cy.get('body').should('not.contain.text', 'Page Not Found')
    cy.get('body').should('not.contain.text', '404')
  })
})
