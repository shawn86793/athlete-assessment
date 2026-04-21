// ── 10 · Season & Attendance ───────────────────────────────────────────────
// Tests season event creation and the attendance dashboard render.
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

describe('Season — hub loads and shows season tiles', () => {
  it('home screen shows My Teams section', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.contains('My Teams', { timeout: 12000 }).should('be.visible')
  })

  it('at least one season tile or empty-state message is visible', () => {
    if (!login()) return
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.contains('My Teams', { timeout: 12000 })

    cy.get('body').then($body => {
      const hasTile  = $body.find('.teamCard, [onclick*="openSeason"]').length > 0
      const hasEmpty = $body.text().includes('No teams') ||
                       $body.text().includes('Create your first') ||
                       $body.text().includes('Get started') ||
                       $body.text().includes('No seasons') ||
                       $body.text().includes('first season')
      expect(hasTile || hasEmpty, 'Should show either a season tile or an empty state').to.be.true
    })
  })
})

describe('Season — schedule tab is reachable', () => {
  it('navigates into a season and shows the Schedule tab', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    cy.get('body').then($body => {
      const tile = $body.find('[onclick*="openSeason"], .teamCard').first()
      if (!tile.length) {
        cy.log('⚠️  No seasons found — skipping schedule navigation test')
        return
      }
      cy.wrap(tile).click()

      cy.get('body', { timeout: 10000 }).then($hub => {
        const hasSchedule = $hub.text().includes('Schedule') || $hub.text().includes('Events')
        const hasRoster   = $hub.text().includes('Roster')
        expect(hasSchedule || hasRoster, 'Season hub should show Schedule or Roster').to.be.true
      })
    })
  })
})

describe('Attendance — dashboard loads without errors', () => {
  it('attendance dashboard renders stat cards when opened from a season', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    cy.get('body').then($body => {
      // Navigate directly via the "Attendance Dashboard" tile inside a season hub,
      // not by hunting for "Attendance" text anywhere on the home page.
      const seasonTile = $body.find('[onclick*="openSeason"], .teamCard').first()
      if (!seasonTile.length) {
        cy.log('⚠️  No seasons found — skipping attendance test')
        return
      }

      cy.wrap(seasonTile).click()

      // Inside the season hub look for the Attendance Dashboard tile
      cy.get('body', { timeout: 8000 }).then($hub => {
        const hasAttendTile = $hub.find('[onclick*="openAttendanceDash"]').length > 0
        if (!hasAttendTile) {
          cy.log('⚠️  No Attendance Dashboard tile in this season hub — skipping')
          return
        }

        cy.get('[onclick*="openAttendanceDash"]').first().click()

        cy.get('body', { timeout: 10000 }).then($dash => {
          const hasStat = $dash.text().includes('Total Events') ||
                          $dash.text().includes('Response Rate') ||
                          $dash.text().includes('No events') ||
                          $dash.text().includes('Attendance Dashboard') ||
                          $dash.text().includes('Attendance Matrix')
          expect(hasStat, 'Attendance dashboard should show stat cards or empty state').to.be.true
        })
      })
    })
  })
})
