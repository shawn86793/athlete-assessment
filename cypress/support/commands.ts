// ── Custom Cypress commands ────────────────────────────────────────────────
//
// cy.loginViaAPI(email, password)
//   Authenticates directly against Netlify Identity (GoTrue) without touching
//   the UI widget. Injects the session into localStorage so the app boots
//   already signed in on the next cy.visit().
//
// cy.clearAppState()
//   Wipes localStorage so each test starts from a clean slate.

declare global {
  namespace Cypress {
    interface Chainable {
      loginViaAPI(email: string, password: string): Chainable<void>
      clearAppState(): Chainable<void>
    }
  }
}

Cypress.Commands.add('loginViaAPI', (email: string, password: string) => {
  // Step 1: visit the app so Cypress has a domain to write localStorage against
  cy.visit('/')

  // Step 2: obtain a GoTrue token via the password grant
  cy.request({
    method: 'POST',
    url: '/.netlify/identity/token',
    form: true,
    body: {
      grant_type: 'password',
      username: email,
      password: password,
    },
    failOnStatusCode: false,
  }).then((tokenRes) => {
    if (tokenRes.status !== 200) {
      throw new Error(
        `Netlify Identity login failed (${tokenRes.status}): ${JSON.stringify(tokenRes.body)}\n` +
        `Make sure COACH_EMAIL / COACH_PASSWORD are set in cypress.env.json`
      )
    }

    const token = tokenRes.body

    // Step 3: fetch the full user object so gotrue-session is complete.
    // netlify-identity-widget validates that the session has a `user` field
    // with an `id` and `email`; if it's missing the widget silently logs out.
    cy.request({
      method: 'GET',
      url: '/.netlify/identity/user',
      headers: { Authorization: `Bearer ${token.access_token}` },
      failOnStatusCode: false,
    }).then((userRes) => {
      const user = userRes.status === 200 ? userRes.body : {
        // Minimal fallback user object so the widget accepts the session
        id: 'cypress-user',
        email,
        user_metadata: {},
        app_metadata:  {},
        role:          '',
      }

      // Step 4: build a session object that matches the shape gotrue-js
      // writes to localStorage. The critical fields are:
      //   • expires_at  — epoch seconds; without it the widget treats the
      //                   session as expired and clears it on next init
      //   • user        — full user object with id + email
      const session = {
        ...token,
        expires_at: Math.round(Date.now() / 1000) + (token.expires_in || 3600),
        user,
      }

      cy.window().then((win) => {
        win.localStorage.setItem('gotrue-session', JSON.stringify(session))
      })
    })
  })
})

Cypress.Commands.add('clearAppState', () => {
  cy.clearLocalStorage()
  cy.clearCookies()
})
