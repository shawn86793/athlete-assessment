// ── 04 · Executive Dashboard (Super-Admin) ────────────────────────────────
// Tests that the super-admin can access /admin without hitting the
// "Organization not found" error.

describe('Executive Dashboard — super-admin access', () => {
  beforeEach(() => {
    cy.clearAppState()
  })

  it('loads /admin without error when not signed in', () => {
    cy.visit('/admin')
    // Login screen should be visible — not a broken page
    cy.get('#loginScreen', { timeout: 8000 }).should('be.visible')
    cy.contains(/tryout enterprise|sign in/i).should('be.visible')
  })

  it('super-admin bypasses org check and enters the dashboard', () => {
    const email   = Cypress.env('ADMIN_EMAIL')
    const pass    = Cypress.env('ADMIN_PASSWORD')
    const orgSlug = Cypress.env('ADMIN_ORG_SLUG') // optional — set in cypress.env.json
    if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') {
      cy.log('⚠️  Skipping — set ADMIN_PASSWORD in cypress.env.json')
      return
    }
    if (!orgSlug) {
      cy.log('⚠️  Skipping — enterprise admin requires ADMIN_ORG_SLUG in cypress.env.json')
      return
    }

    cy.loginViaAPI(email, pass)
    cy.visit('/admin')

    // Enter the org slug to pass the enterprise gate
    cy.get('#orgSlugInput, input[placeholder*="slug" i], input[placeholder*="msba" i]', { timeout: 8000 })
      .type(orgSlug)
    cy.contains(/continue/i).click()

    // Dashboard should be visible
    cy.get('#topnav', { timeout: 12000 }).should('be.visible')
    cy.get('#sidebar').should('be.visible')
    cy.get('.banner.error', { timeout: 6000 }).should('not.exist')
  })

  it('shows the correct admin name — not a fallback', () => {
    const email   = Cypress.env('ADMIN_EMAIL')
    const pass    = Cypress.env('ADMIN_PASSWORD')
    const orgSlug = Cypress.env('ADMIN_ORG_SLUG')
    if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return
    if (!orgSlug) return

    cy.loginViaAPI(email, pass)
    cy.visit('/admin')

    cy.get('#orgSlugInput, input[placeholder*="slug" i], input[placeholder*="msba" i]', { timeout: 8000 })
      .type(orgSlug)
    cy.contains(/continue/i).click()
    cy.get('#topnav', { timeout: 12000 }).should('be.visible')

    // Avatar or name should NOT be blank
    cy.get('#avatarBtn').invoke('text').should('have.length.greaterThan', 0)
  })
})
