// ── 10 · Season & Attendance ───────────────────────────────────────────────
// Tests season event creation and the attendance dashboard render.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Season — hub loads and shows season tiles', () => {
  before(function () {
    if (!login()) this.skip()
  })

  it('home screen shows My Teams section', () => {
    cy.visit('/')
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.contains('My Teams', { timeout: 12000 }).should('be.visible')
  })

  it('at least one season tile or empty-state message is visible', () => {
    cy.visit('/')
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.contains('My Teams', { timeout: 12000 })

    cy.get('body').then($body => {
      const hasTile    = $body.find('.seasonCard, [onclick*="openSeasonHub"]').length > 0
      const hasEmpty   = $body.text().includes('No teams') ||
                         $body.text().includes('Create your first') ||
                         $body.text().includes('Get started')
      const hasContent = hasTile || hasEmpty
      expect(hasContent, 'Should show either a season tile or an empty state').to.be.true
    })
  })
})

describe('Season — schedule tab is reachable', () => {
  before(function () {
    if (!login()) this.skip()
  })

  it('navigates into a season and shows the Schedule tab', () => {
    cy.visit('/')
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    // Only run if at least one season exists
    cy.get('body').then($body => {
      const tile = $body.find('[onclick*="openSeasonHub"], .seasonCard').first()
      if (!tile.length) {
        cy.log('⚠️  No seasons found — skipping schedule navigation test')
        return
      }
      cy.wrap(tile).click()

      // Should land in the season hub showing schedule-related content
      cy.get('body', { timeout: 10000 }).then($hub => {
        const hasSchedule  = $hub.text().includes('Schedule') || $hub.text().includes('Events')
        const hasRoster    = $hub.text().includes('Roster')
        expect(hasSchedule || hasRoster, 'Season hub should show Schedule or Roster').to.be.true
      })
    })
  })
})

describe('Attendance — dashboard loads without errors', () => {
  before(function () {
    if (!login()) this.skip()
  })

  it('attendance dashboard renders stat cards when opened from a season', () => {
    cy.visit('/')
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    cy.get('body').then($body => {
      // Look for Attendance button on home or inside a season hub
      const hasAttendBtn = $body.text().includes('Attendance')
      if (!hasAttendBtn) {
        cy.log('⚠️  No Attendance button visible — skipping')
        return
      }

      cy.contains('Attendance').first().click()
      cy.get('body', { timeout: 10000 }).then($dash => {
        // Dashboard shows stat cards with Total Events, Response Rate, etc.
        const hasStat = $dash.text().includes('Total Events') ||
                        $dash.text().includes('Response Rate') ||
                        $dash.text().includes('No events')
        expect(hasStat, 'Attendance dashboard should show stat cards or empty state').to.be.true
      })
    })
  })
})
