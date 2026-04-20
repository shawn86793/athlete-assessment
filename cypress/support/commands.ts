// ── Custom Cypress commands ────────────────────────────────────────────────
//
// cy.loginViaAPI(email, password)
//   Authenticates directly against Netlify Identity (GoTrue) without touching
//   the UI widget. Injects the session into localStorage via onBeforeLoad so
//   the Netlify Identity Widget reads it on its very first init — before any
//   token-refresh logic can clear it.
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
  // Step 1: obtain a GoTrue token via the password grant.
  // cy.request works without an active page — it uses baseUrl.
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

    // Step 2: fetch the full user object — the widget validates that the
    // stored session has a user.id + user.email; without them it silently
    // clears the session on init.
    cy.request({
      method: 'GET',
      url: '/.netlify/identity/user',
      headers: { Authorization: `Bearer ${token.access_token}` },
      failOnStatusCode: false,
    }).then((userRes) => {
      const user = userRes.status === 200 ? userRes.body : {
        id: 'cypress-user',
        email,
        user_metadata: {},
        app_metadata:  {},
        role:          '',
      }

      // Step 3: build a session object matching the shape gotrue-js writes.
      // expires_at must be a future epoch-seconds value so the widget treats
      // the token as valid (not expired) on its first init and does NOT attempt
      // a refresh call that could race with the test.
      const session = {
        ...token,
        expires_at: Math.round(Date.now() / 1000) + (token.expires_in || 3600),
        user,
      }

      // Step 4: visit the app with onBeforeLoad to inject the session into
      // localStorage BEFORE any page JavaScript runs. This ensures the Netlify
      // Identity Widget reads a valid, non-expired session on first init and
      // fires the "init" event with the user object — avoiding the race
      // condition where the widget initialized with an empty session before
      // our setItem() call.
      cy.visit('/', {
        onBeforeLoad(win) {
          win.localStorage.setItem('gotrue-session', JSON.stringify(session))
        },
      })
    })
  })
})

Cypress.Commands.add('clearAppState', () => {
  cy.clearLocalStorage()
  cy.clearCookies()
})
