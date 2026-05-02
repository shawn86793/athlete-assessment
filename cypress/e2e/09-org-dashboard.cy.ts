// ── 09 · Organization Dashboard ────────────────────────────────────────────
//
// Key design decision: ALL localStorage seeding happens in onBeforeLoad,
// before the app's `let DB = loadDB()` executes. DB is a top-level `let`
// (not on window), so patching win.DB after page load has no effect.
// We replicate the same auth-stub logic from commands.ts (netlifyIdentity
// stub + requestIdleCallback override) so we only need ONE cy.visit per test.

const ORG_ID   = 'cypress-org-001'
const ORG_NAME = 'Cypress FC'
const EMAIL    = Cypress.env('COACH_EMAIL')    || 'cypress@example.com'
const PASS     = Cypress.env('COACH_PASSWORD') || ''

// ── helpers ────────────────────────────────────────────────────────────────

/** Replicates the app's storageKeySuffix() + buildStorageKey() */
function appDbKey(email: string): string {
  const suffix = email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')
  return `SWG_TRYOUT_SYSTEMS_DB_V6::${suffix}`
}

/** Build a synthetic gotrue session (mirrors commands.ts buildSyntheticSession) */
function syntheticSession(email: string) {
  const expiresAt = Math.round(Date.now() / 1000) + 3600
  const user = {
    id: 'cypress-user-' + Date.now(), email,
    user_metadata: {}, app_metadata: { provider: 'email', providers: ['email'] },
    role: 'authenticated', aud: 'authenticated',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
  return {
    access_token: 'cypress-synthetic-access-token',
    refresh_token: 'cypress-synthetic-refresh-token',
    token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user,
  }
}

/** Build the seed DB that includes a mock team + the org + two tryouts */
function buildSeedDB(email: string) {
  const yr = new Date().getFullYear()
  const t1id = ORG_ID + '-try-1'
  const t2id = ORG_ID + '-try-2'
  const mockTeamId = 'cypress-mock-team'
  return {
    version: 6,
    teams: [{ id: mockTeamId, name: 'Cypress Test Team', createdAt: Date.now() }],
    orgs: [{ id: ORG_ID, name: ORG_NAME, sport: 'Soccer', city: 'Test City', year: '2025' }],
    seasons: {},
    tryouts: {
      [t1id]: {
        id: t1id, orgId: ORG_ID, name: 'U13 Spring 2025', sport: 'Soccer',
        tryoutDate: '2025-04-01', archived: false, registrationCode: 'CY-U13',
        headAssessor: 'Coach Test', headAssessorEmail: email,
        assessors: [], roster: [], evals: [],
        settings: { skaterWeights: {}, goalieWeights: {}, customRubrics: [] },
        createdAt: Date.now(), updatedAt: Date.now(),
        registrations: [
          {
            id: 'r1', firstName: 'Alice', lastName: 'Smith',
            birthYear: String(yr - 12), position: 'Forward', currentTeam: 'City SC',
            paymentStatus: 'paid', paid: true,
            guardianName: 'Bob Smith', guardianEmail: 'bob@example.com',
            guardianPhone: '555-1234', registeredAt: new Date().toISOString(),
          },
          {
            id: 'r2', firstName: 'Carlos', lastName: 'Diaz',
            birthYear: String(yr - 11), position: 'Midfielder', currentTeam: 'West Valley',
            paymentStatus: 'unpaid', paid: false,
            guardianName: 'Maria Diaz', guardianEmail: 'maria@example.com',
            guardianPhone: '555-5678', registeredAt: new Date().toISOString(),
          },
        ],
      },
      [t2id]: {
        id: t2id, orgId: ORG_ID, name: 'U9 Fall 2025', sport: 'Soccer',
        tryoutDate: '2025-09-01', archived: false,
        headAssessor: 'Coach Test', headAssessorEmail: email,
        assessors: [], roster: [], evals: [],
        settings: { skaterWeights: {}, goalieWeights: {}, customRubrics: [] },
        createdAt: Date.now(), updatedAt: Date.now(),
        registrations: [],
      },
    },
  }
}

/**
 * Single cy.visit that seeds everything in onBeforeLoad before app JS runs.
 * Mirrors mountSession() from commands.ts, but pre-loads the org + tryout data.
 */
function visitWithOrgSeed(email: string, viewport?: { width: number; height: number }) {
  if (viewport) cy.viewport(viewport.width, viewport.height)

  // For real credentials, get a real token first; otherwise use synthetic
  const PLACEHOLDERS = ['YOUR_PASSWORD_HERE', 'PLACEHOLDER', '', 'password', 'changeme']
  const useSynthetic = !PASS || PLACEHOLDERS.includes(PASS)

  const doVisit = (session: any) => {
    cy.visit('/', {
      onBeforeLoad(win: Cypress.AUTWindow) {
        const w = win as any

        // Wipe any stale data
        win.localStorage.clear()
        win.sessionStorage.clear()

        // ── 1. Auth session ───────────────────────────────────────────────
        win.localStorage.setItem('gotrue-session', JSON.stringify(session))

        // ── 2. Pre-seeded DB (org + tryouts + mock team) ──────────────────
        const dbKey = appDbKey(email)
        win.localStorage.setItem(dbKey, JSON.stringify(buildSeedDB(email)))

        // ── 3. Team selection key ─────────────────────────────────────────
        const suffix = email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')
        win.localStorage.setItem(`AAS_CURRENT_TEAM::${suffix}`, 'cypress-mock-team')
        win.localStorage.setItem('aas_onboarding_wizard_skipped', '1')

        // ── 4. netlifyIdentity stub ───────────────────────────────────────
        const handlers: Record<string, Array<(arg?: unknown) => void>> = {}
        const triggered: Record<string, unknown> = {}
        const mockUser = {
          ...session.user,
          token: {
            access_token: session.access_token,
            refresh_token: session.refresh_token || '',
            expires_at: session.expires_at,
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
          refresh: () => Promise.resolve(session.access_token),
        }

        // ── 5. requestIdleCallback override ──────────────────────────────
        w.requestIdleCallback = (cb: IdleRequestCallback, _opts?: IdleRequestOptions) => {
          cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline)
          return 0
        }
      },
    })
  }

  if (useSynthetic) {
    doVisit(syntheticSession(email))
  } else {
    const baseUrl = Cypress.config('baseUrl') as string
    cy.task('netlifyIdentityToken', { baseUrl, email, password: PASS }).then((tokenData: any) => {
      const sess = tokenData
        ? { ...tokenData, expires_at: Math.round(Date.now() / 1000) + (tokenData.expires_in || 3600), user: tokenData.user ?? syntheticSession(email).user }
        : syntheticSession(email)
      doVisit(sess)
    })
  }
}

// ── shared beforeEach ──────────────────────────────────────────────────────
beforeEach(() => {
  visitWithOrgSeed(EMAIL)
  // Org banner must appear — confirms DB seeded correctly and auth succeeded
  cy.contains(ORG_NAME, { timeout: 12000 }).should('be.visible')
})

// ── helper: open the org dashboard to a specific panel ────────────────────
function openDashboard(panel = '') {
  cy.contains(ORG_NAME).first().click()
  cy.get('#orgDashOverlay', { timeout: 8000 }).should('be.visible')
  if (panel) {
    cy.get('#orgDashOverlay')
      .contains('button, [data-panel]', new RegExp(panel, 'i'), { timeout: 4000 })
      .click()
  }
}

// ── 1. Open overlay ────────────────────────────────────────────────────────
it('opens the org dashboard overlay when clicking the org banner', () => {
  openDashboard()
  cy.get('#orgDashOverlay').contains(ORG_NAME).should('be.visible')
})

// ── 2. Age-grouped accordion ───────────────────────────────────────────────
it('shows age-grouped registration accordion in the Registrations panel', () => {
  openDashboard('registrations')
  cy.get('.od-age-group', { timeout: 6000 }).should('have.length.greaterThan', 0)
  cy.get('.od-group-count').first().invoke('text').should('match', /^\d+$/)
  cy.get('.od-reg-row').should('have.length', 2)
})

// ── 3. Search filter ───────────────────────────────────────────────────────
it('filters registration rows by name search', () => {
  openDashboard('registrations')
  cy.get('#odSearchInput', { timeout: 6000 }).type('Alice')
  cy.get('.od-reg-row:visible').should('have.length', 1)
  cy.get('.od-reg-row:visible').should('contain', 'Alice')
})

// ── 4. Registration detail modal ───────────────────────────────────────────
it('opens the registration detail modal on row click', () => {
  openDashboard('registrations')
  cy.get('.od-reg-row', { timeout: 6000 }).first().click()
  cy.get('.swg-modal, .swgModal, [id^="swgModal-"]', { timeout: 5000 }).should('be.visible')
  cy.contains(/alice/i).should('be.visible')
  cy.contains(/guardian/i).should('be.visible')
})

// ── 5. Mark-paid toggle ────────────────────────────────────────────────────
it('toggles payment status on a registration', () => {
  openDashboard('registrations')
  cy.get('.od-reg-row').filter(':contains("Carlos")').first().click()
  cy.get('.swg-modal, .swgModal, [id^="swgModal-"]', { timeout: 5000 }).should('be.visible')
  cy.contains('button', /mark paid|paid|toggle/i).click()
  cy.window().then(win => {
    const db = JSON.parse(win.localStorage.getItem(appDbKey(EMAIL)) || '{}')
    const r2 = db.tryouts?.[ORG_ID + '-try-1']?.registrations?.find((r: any) => r.id === 'r2')
    expect(r2?.paid).to.equal(true)
  })
})

// ── 6. CSV export ──────────────────────────────────────────────────────────
it('triggers a CSV export when clicking Export', () => {
  openDashboard('registrations')
  cy.window().then(win => {
    cy.stub(win.URL, 'createObjectURL').as('csvBlob').returns('blob:fake')
  })
  cy.contains('button', /export.*csv|csv|export/i, { timeout: 5000 }).click()
  cy.get('@csvBlob').should('have.been.called')
})

// ── 7. Assessments panel ───────────────────────────────────────────────────
it('shows org assessment events in the Assessments panel', () => {
  openDashboard('assessments')
  cy.contains('U13 Spring 2025', { timeout: 6000 }).should('be.visible')
  cy.contains('U9 Fall 2025').should('be.visible')
})

// ── 8. Settings panel ─────────────────────────────────────────────────────
it('shows the Settings panel with delete demo data option', () => {
  openDashboard('settings')
  cy.contains(/delete demo|remove demo/i, { timeout: 6000 }).should('exist')
})

// ── 9. Close overlay ───────────────────────────────────────────────────────
it('closes the org dashboard and returns to the home screen', () => {
  openDashboard()
  cy.get('#orgDashOverlay')
    .contains('button', /back to app|close|✕/i, { timeout: 5000 })
    .click()
  cy.get('#orgDashOverlay').should('not.exist').or('not.be.visible')
  cy.contains(ORG_NAME).should('exist')
})

// ── 10. Mobile bottom tab bar ─────────────────────────────────────────────
it('renders the mobile bottom tab bar at 375px viewport width', () => {
  // Re-visit at mobile size so onBeforeLoad stubs are re-applied
  visitWithOrgSeed(EMAIL, { width: 375, height: 812 })
  cy.contains(ORG_NAME, { timeout: 12000 }).should('be.visible').click()
  cy.get('#orgDashOverlay', { timeout: 8000 }).should('be.visible')
  cy.get('#odMobileTabBar', { timeout: 5000 }).should('be.visible')
  cy.get('#odSidebar').should('not.be.visible')
})

// ── 11. Overview stat cards ────────────────────────────────────────────────
it('shows registration and assessment counts in the Overview panel', () => {
  openDashboard()
  cy.get('#orgDashOverlay').contains(/total registrations|registrations/i, { timeout: 6000 }).should('be.visible')
  cy.get('#orgDashOverlay').contains(/\b2\b/).should('exist')
})
