// ── 12 · Manual Page Refresh — Group 2: No stale / phantom team data ───────
// Verifies that after a hard reload no mock artefacts, raw JS values, or
// duplicate team tiles bleed through into the rendered home screen.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Refresh — no stale or phantom team data after reload', () => {

  it('Cypress Test Team mock is not visible after reload', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.reload()
    cy.contains('Sign Out', { timeout: 8000 }).should('exist')
    cy.contains('My Teams', { timeout: 8000 }).should('be.visible')

    // Cloud sync overwrites the seeded mock — it must not appear in the live view
    cy.contains('Cypress Test Team', { timeout: 6000 }).should('not.exist')
  })

  it('no raw JS artefacts rendered on screen after reload', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.reload()
    cy.contains('Sign Out', { timeout: 8000 }).should('exist')

    cy.get('body').then($body => {
      const text = $body.text()
      expect(text, 'Page must not render [object Object]').not.to.include('[object Object]')
      expect(text, 'Page must not render bare "undefined"').not.to.match(/\bundefined\b/)
      expect(text, 'Page must not render bare "null"').not.to.match(/\bnull\b/)
    })
  })

  it('no duplicate team tiles appear after reload', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')
    cy.reload()
    cy.contains('Sign Out', { timeout: 8000 }).should('exist')
    cy.contains('My Teams', { timeout: 8000 }).should('be.visible')

    cy.get('body').then($body => {
      const tiles = $body.find('.teamCard, [onclick*="selectTeam"]')
      if (!tiles.length) {
        cy.log('ℹ️  No team tiles found — skipping duplicate check')
        return
      }
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
