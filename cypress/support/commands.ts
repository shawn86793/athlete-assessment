// ── Custom Cypress commands ────────────────────────────────────────────────
//
// cy.loginViaAPI(email, password)
//   Authenticates against Netlify Identity and visits '/' with the session
//   already in localStorage. Also stubs window.netlifyIdentity so the CDN
//   widget never loads — the stub fires the "init" event the moment the app
//   registers its on("init", ...) handler, guaranteeing there is no race.
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
  // Step 1: obtain a GoTrue token — cy.request uses baseUrl, no page needed
  cy.request({
    method: 'POST',
    url: '/.netlify/identity/token',
    form: true,
    body: { grant_type: 'password', username: email, password: password },
    failOnStatusCode: false,
  }).then((tokenRes) => {
    if (tokenRes.status !== 200) {
      throw new Error(
        `Netlify Identity login failed (${tokenRes.status}): ${JSON.stringify(tokenRes.body)}\n` +
        `Make sure COACH_EMAIL / COACH_PASSWORD are set in cypress.env.json`
      )
    }

    const token = tokenRes.body

    // Step 2: fetch full user object so the session has user.id + user.email
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

      // Step 3: visit with onBeforeLoad to inject auth BEFORE any JS runs
      //
      // The stub uses a LAZY-FIRE strategy:
      //   • The app calls  netlifyIdentity.init()  first
      //   • then calls     netlifyIdentity.on("init", handler)
      //   • Our on() fires the handler immediately (via setTimeout 0) the
      //     moment it is registered — no race, no fixed-delay guess needed.
      //
      // loadIdentityScript() in the app does:
      //   if(window.netlifyIdentity) return Promise.resolve(window.netlifyIdentity)
      // so the real CDN widget is never loaded.
      cy.visit('/', {
        onBeforeLoad(win: Cypress.AUTWindow) {
          // Pre-load session so it's readable on the very first localStorage.getItem
          win.localStorage.setItem('gotrue-session', JSON.stringify(session))

          // Build mock user that matches the app's expected shape
          const mockUser = {
            ...user,
            token: {
              access_token:  token.access_token,
              refresh_token: token.refresh_token || '',
              expires_at:    session.expires_at,
            },
          }

          // Track which events have already been triggered so late on() calls
          // still get their callback fired.
          const handlers: Record<string, Array<(arg?: unknown) => void>> = {}
          const triggered: Record<string, unknown> = {}

          ;(win as any).netlifyIdentity = {
            /**
             * Register a handler. If the event has already been triggered
             * (e.g. "init" fired before the app registered its listener),
             * replay it immediately.
             */
            on(event: string, cb: (arg?: unknown) => void) {
              if (!handlers[event]) handlers[event] = []
              handlers[event].push(cb)
              // Lazy-fire: if this event was already triggered, replay now
              if (Object.prototype.hasOwnProperty.call(triggered, event)) {
                setTimeout(() => cb(triggered[event]), 0)
              }
            },

            /**
             * Called by initIdentityWidget() to start the widget.
             * We fire "init" immediately so it is available before or after
             * the app registers its on("init") handler.
             */
            init() {
              // Mark the event as triggered with the mock user
              triggered['init'] = mockUser
              // Fire any handlers already registered
              ;(handlers['init'] || []).forEach(cb => cb(mockUser))
            },

            open()   { /* no-op */ },
            close()  { /* no-op */ },
            logout() {
              triggered['logout'] = undefined
              ;(handlers['logout'] || []).forEach(cb => cb())
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
