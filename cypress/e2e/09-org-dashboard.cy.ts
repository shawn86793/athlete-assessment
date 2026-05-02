// ── 09 · Organization Dashboard ────────────────────────────────────────────
//
// Key design decision: ALL localStorage seeding happens in onBeforeLoad,
// before the app's `let DB = loadDB()` executes. DB is a top-level `let`
// (not on window), so patching win.DB after page load has no effect.

const ORG_ID   = 'cypress-org-001'
const ORG_NAME = 'Cypress FC'
const EMAIL    = Cypress.env('COACH_EMAIL')    || 'cypress@example.com'
const PASS     = Cypress.env('COACH_PASSWORD') || ''

// ── helpers ────────────────────────────────────────────────────────────────

function appDbKey(email: string): string {
  const suffix = email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')
  return `SWG_TRYOUT_SYSTEMS_DB_V6::${suffix}`
}

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

function buildSeedDB(email: string) {
  const yr   = new Date().getFullYear()
  const t1id = ORG_ID + '-try-1'
  const t2id = ORG_ID + '-try-2'
  return {
    version: 6,
    teams: [{ id: 'cypress-mock-team', name: 'Cypress Test Team', createdAt: Date.now() }],
    orgs:  [{ id: ORG_ID, name: ORG_NAME, sport: 'Soccer', city: 'Test City', year: '2025' }],
    seasons: {},
    tryouts: {
      [t1id]: {
        id: t1id, orgId: ORG_ID, name: 'U13 Spring 2025', sport: 'Soccer',
        tryoutDate: '2025-04-01', archived: false, registrationCode: 'CY-U13',
        // demoGenerated: true so the Settings panel shows the "Clear Demo Data" button
        demoGenerated: true,
        headAssessor: 'Coach Test', headAssessorEmail: email,
        assessors: [], roster: [], evals: [],
        settings: { skaterWeights: {}, goalieWeights: {}, customRubrics: [] },
        createdAt: Date.now(), updatedAt: Date.now(),
        registrations: [
          {
            // The app uses r.registrationId (not r.id) to find regs in _odOpenRegDetail
            registrationId: 'r1', id: 'r1',
            firstName: 'Alice', lastName: 'Smith',
            birthYear: String(yr - 12), yearOfBirth: String(yr - 12),
            position: 'Forward', currentTeam: 'City SC',
            paymentStatus: 'paid', paid: true,
            guardianName: 'Bob Smith', guardianEmail: 'bob@example.com',
            guardianPhone: '555-1234', registeredAt: new Date().toISOString(),
          },
          {
            registrationId: 'r2', id: 'r2',
            firstName: 'Carlos', lastName: 'Diaz',
            birthYear: String(yr - 11), yearOfBirth: String(yr - 11),
            position: 'Midfielder', currentTeam: 'West Valley',
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

function visitWithOrgSeed(email: string, viewport?: { width: number; height: number }) {
  if (viewport) cy.viewport(viewport.width, viewport.height)

  const PLACEHOLDERS = ['YOUR_PASSWORD_HERE', 'PLACEHOLDER', '', 'password', 'changeme']
  const useSynthetic = !PASS || PLACEHOLDERS.includes(PASS)

  const doVisit = (session: any) => {
    cy.visit('/', {
      onBeforeLoad(win: Cypress.AUTWindow) {
        const w = win as any
        win.localStorage.clear()
        win.sessionStorage.clear()

        win.localStorage.setItem('gotrue-session', JSON.stringify(session))

        const dbKey = appDbKey(email)
        win.localStorage.setItem(dbKey, JSON.stringify(buildSeedDB(email)))

        const suffix = email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')
        win.localStorage.setItem(`AAS_CURRENT_TEAM::${suffix}`, 'cypress-mock-team')
        win.localStorage.setItem('aas_onboarding_wizard_skipped', '1')

        // netlifyIdentity stub
        const handlers: Record<string, Array<(arg?: unknown) => void>> = {}
        const triggered: Record<string, unknown> = {}
        const mockUser = {
          ...session.user,
          token: { access_token: session.access_token, refresh_token: session.refresh_token || '', expires_at: session.expires_at },
        }
        w.netlifyIdentity = {
          on(event: string, cb: (arg?: unknown) => void) {
            if (!handlers[event]) handlers[event] = []
            handlers[event].push(cb)
            if (Object.prototype.hasOwnProperty.call(triggered, event)) setTimeout(() => cb(triggered[event]), 0)
          },
          init() { triggered['init'] = mockUser; (handlers['init'] || []).forEach(cb => cb(mockUser)) },
          open() {}, close() {},
          logout() { triggered['logout'] = undefined; (handlers['logout'] || []).forEach(cb => cb()) },
          currentUser: () => mockUser,
          refresh: () => Promise.resolve(session.access_token),
        }

        // Force requestIdleCallback to run synchronously so auth fires immediately
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
  cy.contains(ORG_NAME, { timeout: 12000 }).should('be.visible')
})

// ── open the dashboard to a specific panel ─────────────────────────────────
function openDashboard(panel = '') {
  cy.contains(ORG_NAME).first().click()
  cy.get('#orgDashOverlay', { timeout: 8000 }).should('be.visible')
  if (panel) {
    cy.get('#orgDashOverlay')
      .contains('button', new RegExp(panel, 'i'), { timeout: 4000 })
      .click()
    // Wait for the panel body to update
    cy.get('#orgDashBody', { timeout: 4000 }).should('be.visible')
  }
}

// ── 1. Open overlay ────────────────────────────────────────────────────────
it('opens the org dashboard overlay when clicking the org banner', () => {
  openDashboard()
  cy.get('#orgDashOverlay').should('be.visible')
  cy.get('#orgDashOverlay').contains(ORG_NAME).should('exist')
})

// ── 2. Age-grouped accordion ───────────────────────────────────────────────
it('shows age-grouped registration accordion in the Registrations panel', () => {
  openDashboard('Registrations')
  cy.get('.od-age-group', { timeout: 6000 }).should('have.length.greaterThan', 0)
  cy.get('.od-group-count').first().invoke('text').should('match', /^\d+$/)
  cy.get('.od-reg-row').should('have.length', 2)
})

// ── 3. Search filter ───────────────────────────────────────────────────────
it('filters registration rows by name search', () => {
  openDashboard('Registrations')
  // Real ID is odRegSearch (not odSearchInput)
  cy.get('#odRegSearch', { timeout: 6000 }).type('Alice')
  cy.get('.od-reg-row:visible').should('have.length', 1)
  cy.get('.od-reg-row:visible').should('contain', 'Alice')
})

// ── 4. Registration detail modal ───────────────────────────────────────────
it('opens the registration detail modal on row click', () => {
  openDashboard('Registrations')
  // Click the first visible registration row
  cy.get('.od-reg-row', { timeout: 6000 }).first().click({ force: true })
  // swgModal creates an overlay with className="swgModal"
  cy.get('.swgModal', { timeout: 5000 }).should('be.visible')
  cy.get('.swgModal').contains(/alice|carlos/i).should('be.visible')
  cy.get('.swgModal').contains(/guardian/i).should('be.visible')
})

// ── 5. Mark-paid toggle ────────────────────────────────────────────────────
it('toggles payment status on a registration', () => {
  openDashboard('Registrations')
  // Click Carlos (Unpaid) — use force:true to bypass Cypress actionability check
  cy.get('.od-reg-row').filter(':contains("Carlos")').first().click({ force: true })
  cy.get('.swgModal', { timeout: 5000 }).should('be.visible')
  cy.get('.swgModal').contains('button', /mark paid|paid/i).click()

  // The modal closes and the DB is updated
  cy.window().then(win => {
    const db = JSON.parse(win.localStorage.getItem(appDbKey(EMAIL)) || '{}')
    const r2 = db.tryouts?.[ORG_ID + '-try-1']?.registrations?.find(
      (r: any) => r.registrationId === 'r2' || r.id === 'r2'
    )
    expect(r2?.paid).to.equal(true)
  })
})

// ── 6. CSV export ──────────────────────────────────────────────────────────
it('triggers a CSV export when clicking Export', () => {
  openDashboard('Registrations')
  cy.window().then(win => {
    cy.stub(win.URL, 'createObjectURL').as('csvBlob').returns('blob:fake')
  })
  cy.get('#orgDashOverlay').contains('button', /export.*csv|csv|export/i, { timeout: 5000 }).click()
  cy.get('@csvBlob').should('have.been.called')
})

// ── 7. Assessments panel ───────────────────────────────────────────────────
it('shows org assessment events in the Assessments panel', () => {
  openDashboard('Assessments')
  // Scope to the overlay to avoid finding clipped elements outside it
  cy.get('#orgDashBody', { timeout: 6000 }).contains('U13 Spring 2025').should('exist')
  cy.get('#orgDashBody').contains('U9 Fall 2025').should('exist')
})

// ── 8. Settings panel ─────────────────────────────────────────────────────
it('shows the Settings panel with delete demo data option', () => {
  openDashboard('Settings')
  // "Clear Demo Data" button only renders when demoCount > 0.
  // Our seed has demoGenerated:true on t1, so it should appear.
  cy.get('#orgDashBody', { timeout: 6000 }).contains(/clear demo data|delete demo/i).should('exist')
})

// ── 9. Close overlay ───────────────────────────────────────────────────────
it('closes the org dashboard and returns to the home screen', () => {
  openDashboard()
  // Desktop: "← Back to App" | Mobile: "✕ Close"
  cy.get('#orgDashOverlay').contains('button', /back to app|close/i, { timeout: 5000 }).click()
  // Overlay removed from DOM
  cy.get('#orgDashOverlay').should('not.exist')
  // Home screen is visible again with org banner
  cy.contains(ORG_NAME).should('exist')
})

// ── 10. Mobile bottom tab bar ─────────────────────────────────────────────
it('renders the mobile bottom tab bar at 375px viewport width', () => {
  visitWithOrgSeed(EMAIL, { width: 375, height: 812 })
  cy.contains(ORG_NAME, { timeout: 12000 }).should('be.visible').click()
  cy.get('#orgDashOverlay', { timeout: 8000 }).should('be.visible')
  // Mobile layout: tab bar has id="odMobileTabBar", sidebar (#odSidebar) is absent
  cy.get('#odMobileTabBar', { timeout: 5000 }).should('be.visible')
  cy.get('#odSidebar').should('not.exist')
})

// ── 11. Overview stat cards ────────────────────────────────────────────────
it('shows registration and assessment counts in the Overview panel', () => {
  openDashboard()  // Overview is default
  cy.get('#orgDashBody', { timeout: 6000 }).contains(/registrations/i).should('exist')
  // 2 registrations seeded — the count should appear somewhere
  cy.get('#orgDashBody').contains(/\b2\b/).should('exist')
})
