// ── 12 · Import Player List ────────────────────────────────────────────────
// Tests that the "Import Player List" tile and button appear on the main
// roster/assessment view (beside the Team Builder tile), and that clicking
// it opens the CSV import modal so coaches can bulk-import players without
// first opening the Team Builder.
// loginViaAPI now injects the session via onBeforeLoad so we land on '/'
// already signed in — no second cy.visit('/') needed.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

// ── Tile visibility ────────────────────────────────────────────────────────

describe('Import Player List — tile is visible beside Team Builder', () => {
  it('shows the Import Player List tile in the roster tileGrid', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    // loginViaAPI already navigated to '/' with session pre-loaded
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    cy.get('body').then($body => {
      const hasTile = $body.find('[onclick*="openTryout"], .teamHubTile').length > 0
      if (!hasTile) {
        cy.log('⚠️  No assessments found — skipping tile visibility test')
        return
      }

      cy.get('[onclick*="openTryout"], .teamHubTile').first().click()

      // Import Player List tile should appear in the roster tileGrid
      cy.get('#importPlayerListTile', { timeout: 12000 }).should('exist').and('be.visible')
      cy.get('#importPlayerListTile').should('contain.text', 'Import Player List')
      cy.get('#importPlayerListBtn').should('contain.text', 'Import CSV')
    })
  })

  it('Import Player List tile appears even when the roster already has players', () => {
    if (!login()) return

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    cy.get('body').then($body => {
      const hasTile = $body.find('[onclick*="openTryout"], .teamHubTile').length > 0
      if (!hasTile) {
        cy.log('⚠️  No assessments found — skipping')
        return
      }

      cy.get('[onclick*="openTryout"], .teamHubTile').first().click()

      // Tile must be in the DOM regardless of roster size
      cy.get('#importPlayerListTile', { timeout: 12000 }).should('exist')
    })
  })
})

// ── Modal opens from tile ──────────────────────────────────────────────────

describe('Import Player List — modal opens and validates CSV', () => {
  it('clicking the Import CSV button opens the import modal', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    cy.get('body').then($body => {
      if (!$body.find('[onclick*="openTryout"], .teamHubTile').length) {
        cy.log('⚠️  No assessments found — skipping modal test')
        return
      }

      cy.get('[onclick*="openTryout"], .teamHubTile').first().click()

      cy.get('#importPlayerListBtn', { timeout: 12000 }).click()

      // Modal should appear
      cy.get('#csvImportModal', { timeout: 8000 }).should('be.visible')
      cy.get('#csvImportModal').should('contain.text', 'Import Players')

      // Modal should have a file input or text area for pasting CSV
      cy.get('#csvImportModal').then($modal => {
        const hasFileInput = $modal.find('input[type="file"]').length > 0
        const hasTextArea  = $modal.find('textarea').length > 0
        expect(hasFileInput || hasTextArea, 'Import modal should have a file input or textarea').to.be.true
      })
    })
  })

  it('import modal can be closed with the Cancel button', () => {
    if (!login()) return

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    cy.get('body').then($body => {
      if (!$body.find('[onclick*="openTryout"], .teamHubTile').length) {
        cy.log('⚠️  No assessments found — skipping cancel test')
        return
      }

      cy.get('[onclick*="openTryout"], .teamHubTile').first().click()

      cy.get('#importPlayerListBtn', { timeout: 12000 }).click()
      cy.get('#csvImportModal', { timeout: 8000 }).should('be.visible')

      cy.get('#csvImportModal').contains('Cancel').click()
      cy.get('#csvImportModal').should('not.exist')
    })
  })
})

// ── Tile is NOT inside Team Builder ───────────────────────────────────────

describe('Import Player List — accessible without opening Team Builder', () => {
  it('Import CSV button is reachable from the main roster view, not inside an overlay', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    cy.get('body').then($body => {
      if (!$body.find('[onclick*="openTryout"], .teamHubTile').length) {
        cy.log('⚠️  No assessments found — skipping accessibility test')
        return
      }

      cy.get('[onclick*="openTryout"], .teamHubTile').first().click()

      // The import button must be on the page WITHOUT needing to open any overlay
      cy.get('#freshTBOverlay').should('not.exist')
      cy.get('#teamBuilderDashboardOverlay').should('not.exist')

      // Import button is directly visible
      cy.get('#importPlayerListBtn', { timeout: 12000 }).should('be.visible')
    })
  })
})
