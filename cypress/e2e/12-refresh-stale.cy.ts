// ── 12 · Manual Page Refresh — Group 2: No stale / phantom team data ───────
// Login inside the it block (mirrors 11-refresh.cy.ts) — beforeEach login
// cycles deadlock in CI. All reload + stale-data assertions in one test.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Refresh — no stale or phantom team data after reload', () => {

  it('no mock artefacts, raw JS values, or duplicate tiles after reload', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.reload()
    cy.contains('Sign Out', { timeout: 8000 }).should('exist')
    cy.contains('My Teams', { timeout: 8000 }).should('be.visible')

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
