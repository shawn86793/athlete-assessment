// ── Custom Cypress commands ────────────────────────────────────────────────
//
// cy.loginViaAPI(email, password)
//   Full login strategy using four mechanisms together:
//
//   1. localStorage  — pre-load gotrue-session before ANY page JS runs
//   2. DB seed       — seed a mock team + current-team key so the app
//      goes directly to the home screen instead of the team-select screen.
//      After clearAppState() the DB is empty and needsTeamSelection() is
//      true, which sends the app to renderTeamSelect() — that screen has
//      "Log out" (not "Sign Out") and no "My Teams" heading.  Pre-seeding a
//      mock team makes needsTeamSelection() return false, so the app renders
//      renderHome() with both "Sign Out" and "My Teams" visible.
//   3. netlifyIdentity stub — prevent CDN widget from loading; fire "init"
//      with the mock user via a lazy-fire on() implementation
//   4. requestIdleCallback override — the app defers scheduleIdentityInit()
//      via requestIdleCallback(start, {timeout:2500}). In Cypress the browser
//      is never "idle" so the callback may not fire within the test window.
//      We replace requestIdleCallback with a synchronous executor so start()
//      runs immediately during page script execution, guaranteeing that
//      initIdentityWidget() is called and our stub's init() fires.
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

      cy.visit('/', {
        onBeforeLoad(win: Cypress.AUTWindow) {
          const w = win as any

          // ── 1. Pre-load session ──────────────────────────────────────────
          win.localStorage.setItem('gotrue-session', JSON.stringify(session))

          // ── 2. Seed mock team so app lands on home, not team-select ──────
          // The app uses these storage key formulas (mirrored exactly here):
          //   storageKeySuffix(user) = email.trim().toLowerCase()
          //                            .replace(/[^a-z0-9._-]/g, '_')
          //   STORAGE_KEY  = "SWG_TRYOUT_SYSTEMS_DB_V6::" + suffix
          //   TEAM_KEY     = "AAS_CURRENT_TEAM::"          + suffix
          //
          // Without a seeded team:
          //   needsTeamSelection() → true → currentView = "teamSelect"
          //   renderTeamSelect() shows the Tryout logo + "Log out" button.
          //   No "Sign Out", no "My Teams" → every test times out.
          //
          // With a seeded team:
          //   needsTeamSelection() → false → currentView stays "home"
          //   renderHome() shows "Sign Out" + "My Teams" immediately.
          //   The mock team is harmless — cloud sync overwrites DB.teams with
          //   real data and renderHome() stays the active view throughout.
          const emailSuffix = user.email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')
          const DB_KEY       = `SWG_TRYOUT_SYSTEMS_DB_V6::${emailSuffix}`
          const TEAM_KEY     = `AAS_CURRENT_TEAM::${emailSuffix}`
          const MOCK_TEAM_ID = 'cypress-mock-team'

          win.localStorage.setItem(DB_KEY, JSON.stringify({
            version: 6,
            tryouts: {},
            seasons: {},
            teams: [{ id: MOCK_TEAM_ID, name: 'Cypress Test Team', createdAt: Date.now() }],
          }))
          win.localStorage.setItem(TEAM_KEY, MOCK_TEAM_ID)

          // Prevent the onboarding wizard from covering the home screen.
          // (A "new" user with no tryouts/seasons triggers the wizard unless
          // this flag is set — it would hide "My Teams" and "Sign Out".)
          win.localStorage.setItem('aas_onboarding_wizard_skipped', '1')

          // ── 3. netlifyIdentity stub ──────────────────────────────────────
          // The app's loadIdentityScript() returns early when
          // window.netlifyIdentity already exists, so the CDN widget
          // never loads. Our stub uses lazy-fire: init() records the
          // event; on() fires immediately if the event already fired.
          const handlers: Record<string, Array<(arg?: unknown) => void>> = {}
          const triggered: Record<string, unknown> = {}

          const mockUser = {
            ...user,
            token: {
              access_token:  token.access_token,
              refresh_token: token.refresh_token || '',
              expires_at:    session.expires_at,
            },
          }

          w.netlifyIdentity = {
            on(event: string, cb: (arg?: unknown) => void) {
              if (!handlers[event]) handlers[event] = []
              handlers[event].push(cb)
              // Lazy-fire: replay if event already triggered
              if (Object.prototype.hasOwnProperty.call(triggered, event)) {
                setTimeout(() => cb(triggered[event]), 0)
              }
            },
            init() {
              // Record as triggered and call any already-registered handlers
              triggered['init'] = mockUser
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

          // ── 4. requestIdleCallback override ─────────────────────────────
          // The app calls: requestIdleCallback(start, {timeout:2500})
          // In an active Cypress browser the idle callback may never fire,
          // so initIdentityWidget() — and our stub's init() — would never
          // be called. Replacing requestIdleCallback with a synchronous
          // executor forces start() to run during the page's own script
          // execution, guaranteeing initIdentityWidget() is called.
          w.requestIdleCallback = (
            cb: IdleRequestCallback,
            _opts?: IdleRequestOptions
          ) => {
            cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline)
            return 0
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
