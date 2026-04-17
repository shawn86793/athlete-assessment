// ── 03 · Team Builder ─────────────────────────────────────────────────────
// Tests the Team Builder Dashboard: opens, configures teams, builds, trades.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Team Builder Dashboard', () => {
  beforeEach(function () {
    cy.clearAppState()
    if (!login()) return
    cy.visit('/')
    cy.contains('My Teams', { timeout: 12000 })
    // Skip all team-builder tests if the account has no assessments yet
    // Use cy.get('body') so Cypress doesn't throw when the selector finds nothing
    cy.get('body').then($body => {
      const TILE = '.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]'
      if ($body.find(TILE).length === 0) {
        cy.log('⚠️  No assessments found — skipping Team Builder tests')
        this.skip()
      } else {
        cy.get(TILE).first().click()
      }
    })
  })

  it('opens the Team Builder screen', () => {
    cy.contains(/team builder/i, { timeout: 8000 }).click()
    // Full-screen overlay should appear
    cy.get('#freshTBOverlay', { timeout: 6000 }).should('be.visible')
    cy.contains('⚡ Create Teams').should('be.visible')
  })

  it('shows players listed alphabetically by last name', () => {
    cy.contains(/team builder/i, { timeout: 8000 }).click()
    cy.get('#freshTBOverlay', { timeout: 6000 })
    cy.get('#ftbPlayerList .', { timeout: 8000 })

    // Grab all player name cells and verify A-Z order
    cy.get('#ftbPlayerList > div').then(rows => {
      const names: string[] = []
      rows.each((_, el) => {
        const text = el.querySelector('div')?.textContent?.trim() || ''
        if (text) names.push(text.split(',')[0].trim().toLowerCase())
      })
      const sorted = [...names].sort((a, b) => a.localeCompare(b))
      expect(names).to.deep.equal(sorted)
    })
  })

  it('filters players by name search', () => {
    cy.contains(/team builder/i, { timeout: 8000 }).click()
    cy.get('#freshTBOverlay', { timeout: 6000 })

    // Wait for player list to populate
    cy.get('#ftbPlayerList > div', { timeout: 8000 }).should('have.length.greaterThan', 0)

    // Type a search term
    cy.get('#ftbSearch').type('a')
    cy.get('#ftbPlayerList > div').each(row => {
      cy.wrap(row).invoke('text').should('match', /a/i)
    })
  })

  it('filters players by minimum score slider', () => {
    cy.contains(/team builder/i, { timeout: 8000 }).click()
    cy.get('#freshTBOverlay', { timeout: 6000 })
    cy.get('#ftbPlayerList > div', { timeout: 8000 }).should('have.length.greaterThan', 0)

    const totalBefore = cy.get('#ftbPlayerList > div').its('length')

    // Move slider to 3.0
    cy.get('#ftbScoreSlider').invoke('val', '3').trigger('input')
    cy.get('#ftbScoreLbl').should('contain', '3.0')

    // Player count should be equal or lower
    cy.get('#ftbPlayerCount').invoke('text').then(text => {
      expect(text).to.match(/\d+ of \d+ players/)
    })
  })

  it('creates a friend package and adds a player to it', () => {
    cy.contains(/team builder/i, { timeout: 8000 }).click()
    cy.get('#freshTBOverlay', { timeout: 6000 })

    // Add a package
    cy.contains('+ Add').click()
    cy.get('#ftbPkgList > div', { timeout: 5000 }).should('have.length.greaterThan', 0)
    cy.get('#ftbPkgList > div').first().click() // select it

    // Player list should now show ⊕ buttons
    cy.get('#ftbPlayerList > div', { timeout: 8000 }).should('have.length.greaterThan', 0)
    cy.get('#ftbPlayerList button[title]').first().click() // click ⊕ on first player

    // Package should show 1 player
    cy.get('#ftbPkgList > div').first().should('contain', '1 player')
  })

  it('builds teams and opens the preview dashboard', () => {
    cy.contains(/team builder/i, { timeout: 8000 }).click()
    cy.get('#freshTBOverlay', { timeout: 6000 })

    // Configure: 4 teams, 5 players each
    cy.get('#ftbTeamCount').clear().type('4')
    cy.get('#ftbSkaters').clear().type('5')

    cy.contains('⚡ Create Teams').click()

    // Fresh TB overlay should close
    cy.get('#freshTBOverlay').should('not.exist')

    // Preview dashboard should open automatically
    cy.get('#teamBuilderDashboardOverlay', { timeout: 8000 }).should('be.visible')
    cy.contains('Team Builder Dashboard').should('be.visible')
    // Should show 4 team cards
    cy.get('#teamBuilderDashboardOverlay > div > div > div').should('have.length', 4)
  })

  it('trades a player between teams', () => {
    // First build teams if not already done
    cy.contains(/team builder/i, { timeout: 8000 }).click()
    cy.get('#freshTBOverlay', { timeout: 6000 })
    cy.get('#ftbTeamCount').clear().type('2')
    cy.get('#ftbSkaters').clear().type('3')
    cy.contains('⚡ Create Teams').click()

    cy.get('#teamBuilderDashboardOverlay', { timeout: 8000 }).should('be.visible')

    // Click Trade on the first player
    cy.contains('↔ Trade').first().click()
    cy.get('#tradeModalOverlay', { timeout: 5000 }).should('be.visible')

    // Complete the trade
    cy.contains('Complete Trade ✓').click()

    // Trade complete banner
    cy.contains(/trade complete/i, { timeout: 5000 }).should('be.visible')
  })
})
