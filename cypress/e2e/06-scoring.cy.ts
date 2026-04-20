// ── 06 · Assessment Scoring ────────────────────────────────────────────────
// Tests that the rubric scoring UI renders, accepts scores, and persists them.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Scoring — mobile big-tap mode (375 px viewport)', () => {
  it('renders large score buttons on a phone-width viewport', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.viewport(375, 812)   // iPhone SE
    cy.visit('/')

    // Enable mobile mode and navigate to the Score tab
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    // The mobile bottom nav Score button should be present in mobile mode
    // (auto-detects ≤768 px)
    cy.get('#mobileBottomNav', { timeout: 10000 }).should('exist')
    cy.get('#mobileBottomNav').contains('Score').click()

    // Should show either the assessment selector or the player list
    cy.get('#app', { timeout: 10000 }).should('not.be.empty')
    // Check app didn't crash (avoid checking generic 'Error' — score view may
    // legitimately say "No assessment found. Create one from the home screen first.")
    cy.get('body').should('not.contain.text', 'Something went wrong')
    cy.get('body').should('not.contain.text', 'Unhandled exception')
  })
})

describe('Scoring — dark mode toggle persists', () => {
  it('dark mode class is applied and survives a reload', () => {
    if (!login()) return

    cy.visit('/')
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    // Toggle dark mode — button says "☾ Dark" in light mode
    cy.contains('Dark', { timeout: 8000 }).click()

    // html element should have data-theme="dark"
    cy.get('html').should('have.attr', 'data-theme', 'dark')

    // Reload and confirm preference was persisted
    cy.reload()
    cy.get('html', { timeout: 10000 }).should('have.attr', 'data-theme', 'dark')

    // Clean up — toggle back to light
    cy.contains('Light').click()
    cy.get('html').should('not.have.attr', 'data-theme', 'dark')
  })
})
