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
// When COACH_PASSWORD is a placeholder or the Identity endpoint is
// unreachable, loginViaAPI falls back to a fully synthetic session so
// UI-flow tests still run without real credentials.
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

/** Build a synthetic (offline-safe) session without hitting the Identity API */
function buildSyntheticSession(email: string) {
  const user = {
    id: 'cypress-user-' + Date.now(),
    email,
    user_metadata: {},
    app_metadata:  { provider: 'email', providers: ['email'] },
    role:          'authenticated',
    aud:           'authenticated',
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString(),
  }
  const expiresAt = Math.round(Date.now() / 1000) + 3600
  return {
    access_token:  'cypress-synthetic-access-token',
    refresh_token: 'cypress-synthetic-refresh-token',
    token_type:    'bearer',
    expires_in:    3600,
    expires_at:    expiresAt,
    user,
  }
}

const PLACEHOLDER_PASSWORDS = ['YOUR_PASSWORD_HERE', 'PLACEHOLDER', '', 'password', 'changeme']

Cypress.Commands.add('loginViaAPI', (email: string, password: string) => {
  const useSynthetic = !password || PLACEHOLDER_PASSWORDS.includes(password)

  if (useSynthetic) {
    // ── Synthetic path: no network request needed ─────────────────────────
    cy.log('ℹ️  loginViaAPI: using synthetic session (no real credentials)')
    const session = buildSyntheticSession(email)
    cy.wrap(session).then((sess: any) => mountSession(email, sess))
    return
  }

  // ── Real auth path ────────────────────────────────────────────────────────
  cy.request({
    method: 'POST',
    url:    '/.netlify/identity/token',
    form:   true,
    body:   { grant_type: 'password', username: email, password },
    failOnStatusCode: false,
    timeout: 8000,   // fail fast — don't hang for 30 s
  }).then((tokenRes) => {
    if (tokenRes.status !== 200) {
      // Identity endpoint unreachable or creds wrong — fall back to synthetic
      cy.log(
        `⚠️  Identity login failed (${tokenRes.status}) — falling back to synthetic session.\n` +
        `Check COACH_EMAIL / COACH_PASSWORD in cypress.env.json if you need real-auth tests.`
      )
      mountSession(email, buildSyntheticSession(email))
      return
    }

    const token = tokenRes.body

    cy.request({
      method:  'GET',
      url:     '/.netlify/identity/user',
      headers: { Authorization: `Bearer ${token.access_token}` },
      failOnStatusCode: false,
      timeout: 5000,
    }).then((userRes) => {
      const user = userRes.status === 200 ? userRes.body : buildSyntheticSession(email).user
      const session = {
        ...token,
        expires_at: Math.round(Date.now() / 1000) + (token.expires_in || 3600),
        user,
      }
      mountSession(email, session)
    })
  })
})

/**
 * Seeds localStorage + stubs netlifyIdentity + overrides requestIdleCallback,
 * then visits '/' so the app boots into the home dashboard.
 */
function mountSession(email: string, session: any) {
  cy.visit('/', {
    onBeforeLoad(win: Cypress.AUTWindow) {
      const w = win as any

      // ── 0. Wipe any stale data from previous test runs ────────────────
      // cy.clearLocalStorage() runs before cy.visit() (in beforeEach), but at
      // that point the AUT frame is still at about:blank — the wrong origin.
      // Clearing here, inside onBeforeLoad, guarantees we're wiping the live
      // site's localStorage before a single line of app JS has executed.
      win.localStorage.clear()
      win.sessionStorage.clear()

      // ── 1. Pre-load session ────────────────────────────────────────────
      win.localStorage.setItem('gotrue-session', JSON.stringify(session))

      // ── 2. Seed mock team ──────────────────────────────────────────────
      const emailSuffix  = email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')
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

      // Prevent onboarding wizard from covering home screen
      win.localStorage.setItem('aas_onboarding_wizard_skipped', '1')

      // ── 3. netlifyIdentity stub ────────────────────────────────────────
      const handlers:  Record<string, Array<(arg?: unknown) => void>> = {}
      const triggered: Record<string, unknown> = {}

      const mockUser = {
        ...session.user,
        token: {
          access_token:  session.access_token,
          refresh_token: session.refresh_token || '',
          expires_at:    session.expires_at,
        },
      }

      w.netlifyIdentity = {
        on(event: string, cb: (arg?: unknown) => void) {
          if (!handlers[event]) handlers[event] = []
          handlers[event].push(cb)
          if (Object.prototype.hasOwnProperty.call(triggered, event)) {
            setTimeout(() => cb(triggered[event]), 0)
          }
        },
        init() {
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
        refresh:     () => Promise.resolve(session.access_token),
      }

      // ── 4. requestIdleCallback override ───────────────────────────────
      w.requestIdleCallback = (
        cb: IdleRequestCallback,
        _opts?: IdleRequestOptions
      ) => {
        cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline)
        return 0
      }
    },
  })
}

Cypress.Commands.add('clearAppState', () => {
  cy.clearLocalStorage()
  cy.clearCookies()
})
