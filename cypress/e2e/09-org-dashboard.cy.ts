// ── 09 · Organization Dashboard ────────────────────────────────────────────
//
// All tests share ONE cy.visit (from loginViaAPI in beforeEach).  We NEVER
// call cy.visit again inside a test body because that would lose the
// netlifyIdentity stub that loginViaAPI sets up in onBeforeLoad.
//
// After loginViaAPI the app is already showing the home dashboard.  We seed
// the org + tryout data directly into localStorage using the real DB key that
// the app uses (SWG_TRYOUT_SYSTEMS_DB_V6::<email-suffix>), then call the
// app's own render function so the org banner appears without a reload.

const ORG_ID   = 'cypress-org-001'
const ORG_NAME = 'Cypress FC'

const EMAIL = Cypress.env('COACH_EMAIL')    || 'cypress@example.com'
const PASS  = Cypress.env('COACH_PASSWORD') || ''

/** Replicate the app's storage key formula (storageKeySuffix + buildStorageKey) */
function appDbKey(email: string): string {
  const suffix = email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')
  return `SWG_TRYOUT_SYSTEMS_DB_V6::${suffix}`
}

/** Seed org + two tryouts into the app's real localStorage DB key */
function seedOrg(win: Cypress.AUTWindow): void {
  const key = appDbKey(EMAIL)
  let db: any = {}
  try { db = JSON.parse(win.localStorage.getItem(key) || '{}') } catch (_) {}

  db.orgs = db.orgs || []
  if (!db.orgs.find((o: any) => o.id === ORG_ID)) {
    db.orgs.push({
      id: ORG_ID, name: ORG_NAME, sport: 'Soccer',
      city: 'Test City', year: '2025',
    })
  }

  db.tryouts = db.tryouts || {}
  const yr = new Date().getFullYear()
  const t1id = ORG_ID + '-try-1'
  const t2id = ORG_ID + '-try-2'

  db.tryouts[t1id] = {
    id: t1id, orgId: ORG_ID, name: 'U13 Spring 2025', sport: 'Soccer',
    tryoutDate: '2025-04-01', archived: false, registrationCode: 'CY-U13',
    registrations: [
      {
        id: 'r1', firstName: 'Alice', lastName: 'Smith',
        birthYear: String(yr - 12), position: 'Forward',
        currentTeam: 'City SC', paymentStatus: 'paid', paid: true,
        guardianName: 'Bob Smith', guardianEmail: 'bob@example.com',
        guardianPhone: '555-1234', registeredAt: new Date().toISOString(),
      },
      {
        id: 'r2', firstName: 'Carlos', lastName: 'Diaz',
        birthYear: String(yr - 11), position: 'Midfielder',
        currentTeam: 'West Valley', paymentStatus: 'unpaid', paid: false,
        guardianName: 'Maria Diaz', guardianEmail: 'maria@example.com',
        guardianPhone: '555-5678', registeredAt: new Date().toISOString(),
      },
    ],
    roster: [], evals: [],
    settings: { skaterWeights: {}, goalieWeights: {}, customRubrics: [] },
    headAssessor: 'Coach Test', headAssessorEmail: EMAIL,
    assessors: [], createdAt: Date.now(), updatedAt: Date.now(),
  }
  db.tryouts[t2id] = {
    id: t2id, orgId: ORG_ID, name: 'U9 Fall 2025', sport: 'Soccer',
    tryoutDate: '2025-09-01', archived: false,
    registrations: [], roster: [], evals: [],
    settings: { skaterWeights: {}, goalieWeights: {}, customRubrics: [] },
    headAssessor: 'Coach Test', headAssessorEmail: EMAIL,
    assessors: [], createdAt: Date.now(), updatedAt: Date.now(),
  }

  win.localStorage.setItem(key, JSON.stringify(db))

  // Re-seed the in-memory DB object if the app exposes it, then re-render
  const w = win as any
  try {
    if (w.DB) {
      w.DB.orgs   = db.orgs
      w.DB.tryouts = db.tryouts
    }
  } catch (_) {}
  try { w.loadDB?.()        } catch (_) {}
  try { w.render?.()        } catch (_) {}
  try { w.renderHomeContent?.() } catch (_) {}
}

// ── shared beforeEach ──────────────────────────────────────────────────────
beforeEach(() => {
  // loginViaAPI does cy.visit('/') with onBeforeLoad stubs — don't visit again
  cy.loginViaAPI(EMAIL, PASS)

  // Seed org data into the correct localStorage key, then re-render in-place
  cy.window().then(seedOrg)

  // Give the home dashboard a moment to reflect the seeded data
  cy.contains(ORG_NAME, { timeout: 10000 }).should('exist')
})

// ── helper: open the org dashboard overlay ─────────────────────────────────
function openDashboard(panel = '') {
  cy.contains(ORG_NAME).first().click()
  cy.get('#orgDashOverlay', { timeout: 8000 }).should('be.visible')
  if (panel) {
    // Click the matching tab/nav item (case-insensitive)
    cy.contains(
      '#orgDashOverlay button, #orgDashOverlay [data-panel]',
      new RegExp(panel, 'i'),
      { timeout: 4000 },
    ).click()
  }
}

// ── 1. Open overlay ────────────────────────────────────────────────────────
it('opens the org dashboard overlay when clicking the org banner', () => {
  openDashboard()
  cy.contains(ORG_NAME).should('be.visible')
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
  // Only Alice's row should remain visible; Carlos's should be hidden
  cy.get('.od-reg-row:visible').should('have.length', 1)
  cy.get('.od-reg-row:visible').should('contain', 'Alice')
})

// ── 4. Registration detail modal ───────────────────────────────────────────
it('opens the registration detail modal on row click', () => {
  openDashboard('registrations')
  cy.get('.od-reg-row', { timeout: 6000 }).first().click()
  // swgModal dialog
  cy.get('.swg-modal, .swgModal, [id^="swgModal-"]', { timeout: 5000 }).should('be.visible')
  cy.contains(/alice/i).should('be.visible')
  cy.contains(/guardian/i).should('be.visible')
})

// ── 5. Mark-paid toggle ────────────────────────────────────────────────────
it('toggles payment status on a registration', () => {
  openDashboard('registrations')
  // Click Carlos (unpaid row)
  cy.get('.od-reg-row').filter(':contains("Carlos")').first().click()
  cy.get('.swg-modal, .swgModal, [id^="swgModal-"]', { timeout: 5000 }).should('be.visible')
  cy.contains('button', /mark paid|paid|toggle/i).click()

  // Confirm the DB was updated
  cy.window().then(win => {
    const key = appDbKey(EMAIL)
    const db  = JSON.parse(win.localStorage.getItem(key) || '{}')
    const t1  = db.tryouts?.[ORG_ID + '-try-1']
    const r2  = t1?.registrations?.find((r: any) => r.id === 'r2')
    expect(r2?.paid).to.equal(true)
  })
})

// ── 6. CSV export ──────────────────────────────────────────────────────────
it('triggers a CSV export when clicking Export', () => {
  openDashboard('registrations')
  // Stub createObjectURL so we can assert it fired without a real download
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
  cy.contains(
    '#orgDashOverlay button',
    /back to app|close|✕/i,
    { timeout: 5000 },
  ).click()
  cy.get('#orgDashOverlay').should('not.exist').or('not.be.visible')
  cy.contains(ORG_NAME).should('exist') // banner still on home
})

// ── 10. Mobile bottom tab bar ─────────────────────────────────────────────
it('renders the mobile bottom tab bar at 375px viewport width', () => {
  // Set viewport then reload (loginViaAPI is re-called which re-visits with stubs)
  cy.viewport(375, 812)
  cy.loginViaAPI(EMAIL, PASS)
  cy.window().then(seedOrg)
  cy.contains(ORG_NAME, { timeout: 10000 }).should('exist').click()
  cy.get('#orgDashOverlay', { timeout: 8000 }).should('be.visible')

  // Mobile layout: bottom tabs visible, sidebar hidden
  cy.get('#odMobileTabBar', { timeout: 5000 }).should('be.visible')
  cy.get('#odSidebar').should('not.be.visible')
})

// ── 11. Overview stat cards ────────────────────────────────────────────────
it('shows registration and assessment counts in the Overview panel', () => {
  openDashboard() // Overview is the default panel
  // 2 registrations were seeded; 2 assessments (tryouts) were seeded
  cy.contains(/total registrations|registrations/i, { timeout: 6000 }).should('be.visible')
  // At least the number "2" should appear somewhere in the stats
  cy.get('#orgDashOverlay').contains(/\b2\b/).should('exist')
})
