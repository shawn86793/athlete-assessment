// ── 11 · Manual Page Refresh ───────────────────────────────────────────────
// Verifies that a hard browser refresh (F5 / Cmd+R) keeps the app on the
// correct home screen — no regression to the team-select screen, no stale
// "Cypress Test Team" mock bleeding through after cloud sync, and no
// persistent offline/sync banners left behind.
//
// Key behaviours tested:
//   1. Home screen survives cy.reload() — Sign Out + My Teams still visible
//   2. Team-select screen does NOT appear (no "Log out" button)
//   3. No phantom "Cypress Test Team" card once real data has loaded
//   4. The #offlineBanner auto-dismisses — it must not be stuck "visible"
//   5. No raw JS artefacts ([object Object], undefined) in the rendered page
//
// localStorage persists across cy.reload() so the gotrue-session + mock-team
// seed from loginViaAPI stay in place.  The app re-initialises via the
// requestIdleCallback timeout path (2 500 ms) rather than our synchronous
// override, so we allow up to 8 s for the screen to settle.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Wait for the app to finish its post-reload identity init cycle.
 * The real requestIdleCallback fires after its 2 500 ms timeout in Cypress,
 * then cloud sync adds another second or two, so 8 s is a safe ceiling.
 */
function waitForHomeAfterReload() {
  cy.contains('Sign Out', { timeout: 8000 }).should('exist')
  cy.contains('My Teams', { timeout: 8000 }).should('be.visible')
}

/**
 * Force any visible sync/offline banner to dismiss itself by waiting for it
 * to lose the "visible" class.  The app calls showBannerTemporary() which
 * removes .visible after 2 000 ms, so 5 s is more than enough.
 */
function assertBannersDismissed() {
  // The banner element is injected dynamically; if it never appeared, that's fine too.
  cy.get('body').then($body => {
    if ($body.find('#offlineBanner').length === 0) return  // banner never created → pass

    cy.get('#offlineBanner', { timeout: 5000 }).should($el => {
      // Must NOT have the .visible class that makes it slide up into view
      expect($el.hasClass('visible'), '#offlineBanner should not be stuck visible').to.be.false
    })
  })
}

// ══════════════════════════════════════════════════════════════════════════════

describe('Refresh — home screen survives a manual reload', () => {

  it('Sign Out and My Teams are visible after cy.reload()', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    // Confirm we are on the home screen before refreshing
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.contains('My Teams', { timeout: 12000 }).should('be.visible')

    // Simulate the user pressing F5 / Cmd+R
    cy.reload()

    // App must recover to home — not team-select
    waitForHomeAfterReload()
  })

  it('team-select screen does NOT appear after reload (no "Log out" button)', () => {
    if (!login()) return

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.reload()

    // Give the app time to fully initialise before asserting absence
    cy.contains('Sign Out', { timeout: 8000 }).should('exist')

    // "Log out" only appears on renderTeamSelect() — it must never show
    cy.contains('Log out').should('not.exist')
    // Confirm the correct button is present instead
    cy.contains('Sign Out').should('exist')
  })

})

// ══════════════════════════════════════════════════════════════════════════════

describe('Refresh — stale / phantom team data is absent', () => {

  it('Cypress Test Team mock is not visible after cloud sync overwrites local DB', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.reload()
    waitForHomeAfterReload()

    // Allow cloud sync to settle (it replaces the mock team with real data)
    // The mock team is intentionally harmless — it should disappear after sync
    cy.wait(3000)

    cy.get('body').then($body => {
      // "Cypress Test Team" should be gone once real data has loaded
      // If no real teams exist the empty state is fine; the mock must not linger
      const text = $body.text()
      expect(text, 'Mock Cypress Test Team should not appear in live view')
        .not.to.include('Cypress Test Team')
    })
  })

  it('no raw JS artefacts rendered on screen after reload', () => {
    if (!login()) return

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.reload()
    waitForHomeAfterReload()

    cy.get('body').then($body => {
      const text = $body.text()
      expect(text, 'Page must not render [object Object]').not.to.include('[object Object]')
      expect(text, 'Page must not render bare "undefined"').not.to.match(/\bundefined\b/)
      expect(text, 'Page must not render bare "null"').not.to.match(/\bnull\b/)
    })
  })

  it('no duplicate team tiles appear after rapid double-reload', () => {
    if (!login()) return

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    // Simulate an aggressive double-refresh scenario
    cy.reload()
    cy.reload()

    waitForHomeAfterReload()

    // Count team tiles — each real team should appear exactly once
    cy.get('body').then($body => {
      const tiles = $body.find('.teamCard, [onclick*="selectTeam"]')
      const names: string[] = []
      tiles.each((_, el) => {
        const name = Cypress.$(el).text().trim().split('\n')[0].trim()
        if (name) names.push(name)
      })
      const unique = new Set(names)
      expect(names.length, 'No team tile should appear more than once').to.equal(unique.size)
    })
  })

})

// ══════════════════════════════════════════════════════════════════════════════

describe('Refresh — sync and offline banners auto-dismiss', () => {

  it('#offlineBanner is not stuck in the visible state after reload', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.reload()

    // Let the sync cycle complete — banners are shown for 2 000 ms then hidden
    waitForHomeAfterReload()
    assertBannersDismissed()
  })

  it('offline banner does not block interaction after reload while online', () => {
    if (!login()) return

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.reload()
    waitForHomeAfterReload()

    // Confirm the body does NOT carry the class that pads content for the banner
    cy.get('body', { timeout: 5000 }).should('not.have.class', 'offline-banner-visible')
  })

  it('no "syncing" banner is visible 6 seconds after reload', () => {
    if (!login()) return

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.reload()
    waitForHomeAfterReload()

    // Wait long enough for any temporary sync banner to have auto-dismissed
    cy.wait(6000)

    cy.get('body').then($body => {
      const banner = $body.find('#offlineBanner')
      if (!banner.length) return   // never appeared → pass
      expect(
        banner.hasClass('visible') && banner.hasClass('syncing'),
        '"Syncing" banner must not remain visible 6 s after reload'
      ).to.be.false
    })
  })

})

// ══════════════════════════════════════════════════════════════════════════════

describe('Refresh — correct view is restored for non-home screens', () => {

  it('refreshing while on the home screen does not drop into a blank view', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.contains('My Teams', { timeout: 12000 }).should('be.visible')

    cy.reload()

    // The app should recover to home, not a blank white page or error screen
    cy.get('#app', { timeout: 8000 }).should('not.be.empty')
    waitForHomeAfterReload()
  })

  it('multiple sequential reloads always return to the home screen', () => {
    if (!login()) return

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    // Three reloads in a row — each must restore home correctly
    for (let i = 0; i < 3; i++) {
      cy.reload()
      cy.contains('Sign Out', { timeout: 8000 }).should('exist')
      cy.contains('Log out').should('not.exist')
    }

    // Final state check
    cy.contains('My Teams', { timeout: 8000 }).should('be.visible')
    assertBannersDismissed()
  })

})
