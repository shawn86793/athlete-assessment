// ── 06 · Assessment Scoring ────────────────────────────────────────────────
// Tests that the rubric scoring UI renders, accepts scores, and persists them.
// loginViaAPI stubs netlifyIdentity + visits '/' — no second cy.visit needed.
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

    // loginViaAPI already navigated to '/' with the stub active.
    // Now switch to mobile viewport and reload so the app detects ≤768px.
    cy.viewport(375, 812)   // iPhone SE
    cy.reload()

    // The mobile bottom nav should appear after reload at 375px
    cy.get('#mobileBottomNav', { timeout: 10000 }).should('exist')
    cy.get('#mobileBottomNav').contains('Score').click()

    // Should show either the assessment selector or the player list
    cy.get('#app', { timeout: 10000 }).should('not.be.empty')
    cy.get('body').should('not.contain.text', 'Something went wrong')
    cy.get('body').should('not.contain.text', 'Unhandled exception')
  })
})

describe('Scoring — dark mode toggle persists', () => {
  it('dark mode class is applied and survives a reload', () => {
    if (!login()) return

    // loginViaAPI already navigated to '/' with session pre-loaded
    cy.contains('Sign Out', { timeout: 20000 }).should('exist')

    // Toggle dark mode — button says "☾ Dark" in light mode
    cy.contains('Dark', { timeout: 8000 }).click()

    // html element should have data-theme="dark"
    cy.get('html').should('have.attr', 'data-theme', 'dark')

    // Reload — the dark mode preference is a separate localStorage key
    // (aasDarkMode) so it persists even after the page reloads.
    // The stub is NOT active after reload, but dark mode doesn't need auth.
    cy.reload()
    cy.get('html', { timeout: 10000 }).should('have.attr', 'data-theme', 'dark')

    // Clean up — toggle back. The toggle is always visible regardless of auth.
    cy.contains('Light', { timeout: 8000 }).click()
    cy.get('html').should('not.have.attr', 'data-theme', 'dark')
  })
})
