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
  }).then((res) => {
    if (res.status !== 200) {
      throw new Error(
        `Netlify Identity login failed (${res.status}): ${JSON.stringify(res.body)}\n` +
        `Make sure COACH_EMAIL / COACH_PASSWORD are set in cypress.env.json`
      )
    }
    // Netlify Identity widget reads from localStorage key "gotrue-session"
    window.localStorage.setItem('gotrue-session', JSON.stringify(res.body))
  })
})

Cypress.Commands.add('clearAppState', () => {
  cy.clearLocalStorage()
  cy.clearCookies()
})
