// ── 11 · Resilience ────────────────────────────────────────────────────────
// localStorage survives a hard reload and the app stays on home (not 404).
// The offline-banner test (cy.intercept forceNetworkError) was removed — it
// blocked Netlify Blobs + Functions routes and left network state damaged for
// every subsequent spec, causing 28 s hangs and 13 min deadlocks downstream.
// Max timeout: 10 s.
// Requires COACH_EMAIL + COACH_PASSWORD in cypress.env.json.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Resilience — localStorage and reload', () => {
  it('localStorage survives a reload and app stays on home (not 404)', () => {
    if (!login()) {
      cy.log('⚠️  Skipping — set COACH_EMAIL + COACH_PASSWORD in cypress.env.json')
      return
    }

    cy.contains('Sign Out', { timeout: 10000 }).should('exist')

    // Write a sentinel value to localStorage
    cy.window().then(win => {
      win.localStorage.setItem('aas_resilience_test', 'sentinel-value')
    })

    cy.reload()

    // Sentinel must survive the reload
    cy.window().then(win => {
      expect(
        win.localStorage.getItem('aas_resilience_test'),
        'localStorage survives a page reload'
      ).to.eq('sentinel-value')
      win.localStorage.removeItem('aas_resilience_test')
    })

    // App must still be on home — not 404 or error
    cy.get('#app', { timeout: 10000 }).should('not.be.empty')
    cy.url().should('not.include', '404')
    cy.url().should('not.include', 'error')
    cy.get('body').should('not.contain.text', 'Page not found')
  })
})
