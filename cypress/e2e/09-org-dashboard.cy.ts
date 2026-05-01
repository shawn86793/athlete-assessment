// ── 09 · Organization Dashboard ────────────────────────────────────────────
// Covers: open dashboard overlay, age-grouped registration accordion,
// registration detail modal, CSV export, "back to app", mobile bottom tabs.

describe('Organization Dashboard', () => {
  const ORG_ID   = 'cypress-org-001';
  const ORG_NAME = 'Cypress FC';

  // Seed a minimal DB into localStorage before each test so the org and
  // a couple of assessment events exist without hitting Netlify.
  beforeEach(() => {
    cy.loginViaAPI(
      Cypress.env('COACH_EMAIL')    || 'cypress@example.com',
      Cypress.env('COACH_PASSWORD') || ''
    );

    cy.window().then(win => {
      const db = JSON.parse(win.localStorage.getItem('aasDB') || '{}');

      // Ensure orgs array exists
      db.orgs = db.orgs || [];
      if (!db.orgs.find((o: any) => o.id === ORG_ID)) {
        db.orgs.push({ id: ORG_ID, name: ORG_NAME, sport: 'Soccer', city: 'Test City', year: '2025' });
      }

      // Seed two tryouts belonging to the org
      db.tryouts = db.tryouts || {};
      const t1id = ORG_ID + '-try-1';
      const t2id = ORG_ID + '-try-2';
      db.tryouts[t1id] = {
        id: t1id, orgId: ORG_ID, name: 'U13 Spring 2025', sport: 'Soccer',
        date: '2025-04-01', archived: false, registrationCode: 'CY-U13',
        registrations: [
          { id: 'r1', firstName: 'Alice', lastName: 'Smith',
            birthYear: String(new Date().getFullYear() - 12),
            position: 'Forward', currentTeam: 'City SC',
            paymentStatus: 'paid', paid: true,
            guardianName: 'Bob Smith', guardianEmail: 'bob@example.com', guardianPhone: '555-1234',
            registeredAt: new Date().toISOString() },
          { id: 'r2', firstName: 'Carlos', lastName: 'Diaz',
            birthYear: String(new Date().getFullYear() - 11),
            position: 'Midfielder', currentTeam: 'West Valley',
            paymentStatus: 'unpaid', paid: false,
            guardianName: 'Maria Diaz', guardianEmail: 'maria@example.com', guardianPhone: '555-5678',
            registeredAt: new Date().toISOString() },
        ],
      };
      db.tryouts[t2id] = {
        id: t2id, orgId: ORG_ID, name: 'U9 Fall 2025', sport: 'Soccer',
        date: '2025-09-01', archived: false, registrations: [],
      };

      win.localStorage.setItem('aasDB', JSON.stringify(db));
      // Trigger a renderHomeContent refresh
      try { (win as any).renderHomeContent?.(); } catch (_) {}
    });
  });

  // ── 1. Open the org dashboard overlay ─────────────────────────────────────
  it('opens the org dashboard overlay when clicking the org banner', () => {
    cy.visit('/');
    // The green org banner should be visible on the home screen
    cy.contains(ORG_NAME, { timeout: 8000 }).should('be.visible').click();

    // The full-screen overlay should appear
    cy.get('#orgDashOverlay', { timeout: 6000 }).should('be.visible');
    cy.contains(ORG_NAME).should('be.visible');
  });

  // ── 2. Registrations panel — age groups ────────────────────────────────────
  it('shows age-grouped registration accordion in the Registrations panel', () => {
    cy.visit('/');
    cy.contains(ORG_NAME, { timeout: 8000 }).click();
    cy.get('#orgDashOverlay', { timeout: 6000 }).should('be.visible');

    // Click the Registrations tab / nav item
    cy.contains('button, [data-panel]', /registrations/i, { timeout: 4000 }).click();

    // At least one age-group accordion header should render
    cy.get('.od-age-group', { timeout: 5000 }).should('have.length.greaterThan', 0);

    // Each age group should show a count badge
    cy.get('.od-group-count').first().invoke('text').should('match', /^\d+$/);

    // Registration rows should be present
    cy.get('.od-reg-row').should('have.length', 2);
  });

  // ── 3. Filter/search narrows rows ─────────────────────────────────────────
  it('filters registration rows by name search', () => {
    cy.visit('/');
    cy.contains(ORG_NAME, { timeout: 8000 }).click();
    cy.get('#orgDashOverlay', { timeout: 6000 }).should('be.visible');
    cy.contains('button, [data-panel]', /registrations/i, { timeout: 4000 }).click();

    cy.get('#odSearchInput', { timeout: 5000 }).type('Alice');

    // Only Alice's row should be visible; Carlos's row should be hidden
    cy.get('.od-reg-row').filter(':visible').should('have.length', 1);
    cy.get('.od-reg-row').filter(':visible').should('contain', 'Alice');
  });

  // ── 4. Registration detail modal opens ────────────────────────────────────
  it('opens the registration detail modal on row click', () => {
    cy.visit('/');
    cy.contains(ORG_NAME, { timeout: 8000 }).click();
    cy.get('#orgDashOverlay', { timeout: 6000 }).should('be.visible');
    cy.contains('button, [data-panel]', /registrations/i, { timeout: 4000 }).click();

    cy.get('.od-reg-row', { timeout: 5000 }).first().click();

    // Modal should appear with player info
    cy.get('.swgModal, [id^="swgModal"]', { timeout: 4000 }).should('be.visible');
    cy.contains(/alice/i).should('be.visible');
    cy.contains(/guardian/i).should('be.visible');
  });

  // ── 5. Mark-paid toggle ────────────────────────────────────────────────────
  it('toggles payment status on a registration', () => {
    cy.visit('/');
    cy.contains(ORG_NAME, { timeout: 8000 }).click();
    cy.get('#orgDashOverlay', { timeout: 6000 }).should('be.visible');
    cy.contains('button, [data-panel]', /registrations/i, { timeout: 4000 }).click();

    // Open Carlos (unpaid)
    cy.get('.od-reg-row').contains(/carlos/i).click();
    cy.get('.swgModal, [id^="swgModal"]', { timeout: 4000 }).should('be.visible');

    // Click mark paid button
    cy.contains('button', /mark paid|toggle paid/i).click();

    // The DB should now have paid:true for r2
    cy.window().then(win => {
      const db = JSON.parse(win.localStorage.getItem('aasDB') || '{}');
      const t1 = db.tryouts[ORG_ID + '-try-1'];
      const r2 = t1.registrations.find((r: any) => r.id === 'r2');
      expect(r2.paid).to.be.true;
    });
  });

  // ── 6. CSV export downloads a file ────────────────────────────────────────
  it('triggers a CSV export when clicking Export', () => {
    cy.visit('/');
    cy.contains(ORG_NAME, { timeout: 8000 }).click();
    cy.get('#orgDashOverlay', { timeout: 6000 }).should('be.visible');
    cy.contains('button, [data-panel]', /registrations/i, { timeout: 4000 }).click();

    // Stub the URL.createObjectURL so we can assert it was called
    cy.window().then(win => {
      cy.stub(win.URL, 'createObjectURL').as('createObjectURL').returns('blob:fake');
      cy.stub(win.document.body, 'appendChild').as('appendChild');
    });

    cy.contains('button', /export.*csv|csv.*export/i, { timeout: 4000 }).click();
    cy.get('@createObjectURL').should('have.been.called');
  });

  // ── 7. Assessments panel lists events ─────────────────────────────────────
  it('shows org assessment events in the Assessments panel', () => {
    cy.visit('/');
    cy.contains(ORG_NAME, { timeout: 8000 }).click();
    cy.get('#orgDashOverlay', { timeout: 6000 }).should('be.visible');

    cy.contains('button, [data-panel]', /assessments/i, { timeout: 4000 }).click();

    // Both seeded tryouts should appear
    cy.contains('U13 Spring 2025').should('be.visible');
    cy.contains('U9 Fall 2025').should('be.visible');
  });

  // ── 8. Settings panel visible ─────────────────────────────────────────────
  it('shows the Settings panel with delete demo data option', () => {
    cy.visit('/');
    cy.contains(ORG_NAME, { timeout: 8000 }).click();
    cy.get('#orgDashOverlay', { timeout: 6000 }).should('be.visible');

    cy.contains('button, [data-panel]', /settings/i, { timeout: 4000 }).click();

    cy.contains(/delete demo data|remove demo/i).should('exist');
  });

  // ── 9. Back to App / close overlay ────────────────────────────────────────
  it('closes the org dashboard and returns to the home screen', () => {
    cy.visit('/');
    cy.contains(ORG_NAME, { timeout: 8000 }).click();
    cy.get('#orgDashOverlay', { timeout: 6000 }).should('be.visible');

    // Click the close / Back to App button
    cy.contains('button', /back to app|✕ close|close/i, { timeout: 4000 }).click();

    cy.get('#orgDashOverlay').should('not.be.visible');
    cy.contains(ORG_NAME).should('be.visible'); // home screen still shows banner
  });

  // ── 10. Mobile: bottom tab bar renders at narrow viewport ─────────────────
  it('renders the mobile bottom tab bar at 375px viewport width', () => {
    cy.viewport(375, 812);
    cy.visit('/');
    cy.contains(ORG_NAME, { timeout: 8000 }).click();
    cy.get('#orgDashOverlay', { timeout: 6000 }).should('be.visible');

    // Mobile layout: bottom tabs should exist
    cy.get('#odMobileTabBar', { timeout: 4000 }).should('be.visible');

    // Desktop sidebar should NOT be visible at this width
    cy.get('#odSidebar').should('not.be.visible');
  });

  // ── 11. Overview panel renders stat cards ────────────────────────────────
  it('shows registration and assessment counts in the Overview panel', () => {
    cy.visit('/');
    cy.contains(ORG_NAME, { timeout: 8000 }).click();
    cy.get('#orgDashOverlay', { timeout: 6000 }).should('be.visible');

    // Overview is the default panel
    cy.contains(/total registrations|assessments/i, { timeout: 5000 }).should('be.visible');
    // 2 regs were seeded
    cy.contains('2').should('be.visible');
  });
});
