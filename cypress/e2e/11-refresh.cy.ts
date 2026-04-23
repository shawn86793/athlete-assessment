// ── 11 · Manual Page Refresh — Group 1: Home screen survives reload ────────
// Verifies that a hard browser refresh keeps the app on the home screen.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Refresh — home screen survives a manual reload', () => {

  it('Sign Out and My Teams visible after reload — no stale or phantom data', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 10000 }).should('exist')
    cy.contains('My Teams', { timeout: 10000 }).should('be.visible')

    cy.reload()

    cy.contains('Sign Out', { timeout: 8000 }).should('exist')
    cy.contains('My Teams', { timeout: 8000 }).should('be.visible')

    // Stale / phantom data checks (absorbed from 12-refresh-stale.cy.ts)
    cy.get('body').then($body => {
      const text = $body.text()
      expect(text).not.to.include('Cypress Test Team')
      expect(text).not.to.include('[object Object]')
      expect(text).not.to.match(/\bundefined\b/)
      expect(text).not.to.match(/\bnull\b/)
      const tiles = $body.find('.teamCard, [onclick*="selectTeam"]')
      if (tiles.length) {
        const names: string[] = []
        tiles.each((_, el) => {
          const name = Cypress.$(el).text().trim().split('\n')[0].trim()
          if (name) names.push(name)
        })
        expect(names.length, 'no duplicate team tiles').to.equal(new Set(names).size)
      }
    })
  })

  it('team-select screen does not appear after reload — no "Log out" button', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    cy.reload()

    cy.contains('Sign Out', { timeout: 8000 }).should('exist')
    cy.contains('Log out').should('not.exist')
  })

})
