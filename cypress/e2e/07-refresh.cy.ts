// ── 07 · Refresh & Resilience ─────────────────────────────────────────────
// Merged from 07-refresh, 11-refresh, 11-resilience.
// All reload checks in 2 tests. Max timeout: 10 s.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Refresh & Resilience', () => {

  it('session, My Teams, localStorage, and no stale data survive a reload', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.contains('Sign Out', { timeout: 10000 }).should('exist')
    cy.contains('My Teams', { timeout: 10000 }).should('be.visible')

    // gotrue-session exists before reload
    cy.window().then(win => {
      expect(win.localStorage.getItem('gotrue-session'), 'session before reload').to.not.be.null
      win.localStorage.setItem('aas_resilience_test', 'sentinel')
    })

    cy.reload()

    cy.contains('Sign Out', { timeout: 8000 }).should('exist')
    cy.contains('My Teams', { timeout: 8000 }).should('be.visible')

    cy.window().then(win => {
      // Session persists
      expect(win.localStorage.getItem('gotrue-session'), 'session after reload').to.not.be.null
      // localStorage survives reload
      expect(win.localStorage.getItem('aas_resilience_test'), 'localStorage survives').to.eq('sentinel')
      win.localStorage.removeItem('aas_resilience_test')
    })

    // No stale / phantom data
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
        expect(names.length, 'no duplicate tiles').to.equal(new Set(names).size)
      }
    })

    // Not a 404 or error page
    cy.get('#app', { timeout: 10000 }).should('not.be.empty')
    cy.url().should('not.include', '404')
    cy.url().should('not.include', 'error')
  })

  it('no team-select screen after reload — no "Log out" button', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 10000 }).should('exist')
    cy.reload()
    cy.contains('Sign Out', { timeout: 8000 }).should('exist')
    cy.contains('Log out').should('not.exist')
  })

})
