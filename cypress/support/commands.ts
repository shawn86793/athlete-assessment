// ── Custom Cypress commands ────────────────────────────────────────────────
//
// cy.loginViaAPI(email, password)
//   Authenticates directly against Netlify Identity (GoTrue) without touching
//   the UI widget. Uses onBeforeLoad to:
//   1. Pre-load gotrue-session into localStorage (before any JS runs)
//   2. Stub window.netlifyIdentity so the REAL widget never loads
//
//   The app code (loadIdentityScript) checks:
//     if(window.netlifyIdentity) return Promise.resolve(window.netlifyIdentity)
//   so our stub prevents the real widget from loading. The stub fires the
//   "init" event with the mock user, which is all the app needs to render
//   the logged-in state — no token refresh network call, no race condition.
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

    // Step 2: fetch the full user object
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
        app_metadata:  { provider: 'email', providers: ['email'] },
        role:          'authenticated',
        aud:           'authenticated',
      }

      const session = {
        ...token,
        expires_at: Math.round(Date.now() / 1000) + (token.expires_in || 3600),
        user,
      }

      // Step 3: Visit with onBeforeLoad to:
      //   a) Pre-inject gotrue-session into localStorage before any JS runs
      //   b) Stub window.netlifyIdentity so the real widget never loads
      //
      // The app's loadIdentityScript() returns early if window.netlifyIdentity
      // already exists, so our stub is used in place of the CDN widget.
      // The stub fires the "init" event with the user object, which is all
      // the app needs to set authState.user and render the logged-in UI.
      cy.visit('/', {
        onBeforeLoad(win: Cypress.AUTWindow) {
          // Pre-load session so gotrue-session is readable on first init
          win.localStorage.setItem('gotrue-session', JSON.stringify(session))

          // Build a minimal netlifyIdentity stub
          const handlers: Record<string, Array<(arg?: unknown) => void>> = {}
          const mockUser = {
            ...user,
            token: {
              access_token:  token.access_token,
              refresh_token: token.refresh_token || '',
              expires_at:    session.expires_at,
            },
          }

          ;(win as any).netlifyIdentity = {
            on(event: string, cb: (arg?: unknown) => void) {
              if (!handlers[event]) handlers[event] = []
              handlers[event].push(cb)
            },
            /** Called by initIdentityWidget() — fire "init" with the user */
            init() {
              // Defer so the app's on("init", ...) handler is registered first
              setTimeout(() => {
                ;(handlers['init'] || []).forEach(cb => cb(mockUser))
              }, 50)
            },
            open()    { /* no-op */ },
            close()   { /* no-op */ },
            logout()  {
              setTimeout(() => {
                ;(handlers['logout'] || []).forEach(cb => cb())
              }, 0)
            },
            currentUser: () => mockUser,
            refresh:     () => Promise.resolve(token.access_token),
          }
        },
      })
    })
  })
})

Cypress.Commands.add('clearAppState', () => {
  cy.clearLocalStorage()
  cy.clearCookies()
})
