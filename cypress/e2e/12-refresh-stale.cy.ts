// ── 12 · Manual Page Refresh — Group 2: No stale / phantom team data ───────
// Single login + reload in beforeEach; all stale-data assertions in one test
// so Cypress doesn't repeat the auth + reload cycle three times.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

describe('Refresh — no stale or phantom team data after reload', () => {

  let shouldRun = false

  beforeEach(() => {
    const email = Cypress.env('COACH_EMAIL')
    const pass  = Cypress.env('COACH_PASSWORD')
    shouldRun = !!(email && pass && pass !== 'YOUR_PASSWORD_HERE')
    if (!shouldRun) return

    cy.loginViaAPI(email, pass)
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.reload()
    cy.contains('Sign Out', { timeout: 8000 }).should('exist')
    cy.contains('My Teams', { timeout: 8000 }).should('be.visible')
  })

  it('no mock artefacts, raw JS values, or duplicate tiles after reload', () => {
    if (!shouldRun) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.get('body').then($body => {
      const text = $body.text()

      // 1. Mock team seeded at login must be gone once cloud sync loads real data
      expect(text, 'Cypress Test Team mock must not appear').not.to.include('Cypress Test Team')

      // 2. No raw JS artefacts from a partially-loaded state
      expect(text, 'No [object Object]').not.to.include('[object Object]')
      expect(text, 'No bare undefined').not.to.match(/\bundefined\b/)
      expect(text, 'No bare null').not.to.match(/\bnull\b/)

      // 3. No duplicate team tiles
      const tiles = $body.find('.teamCard, [onclick*="selectTeam"]')
      if (tiles.length) {
        const names: string[] = []
        tiles.each((_, el) => {
          const name = Cypress.$(el).text().trim().split('\n')[0].trim()
          if (name) names.push(name)
        })
        const unique = new Set(names)
        expect(names.length, 'Each team tile must appear exactly once').to.equal(unique.size)
      }
    })
  })

})
