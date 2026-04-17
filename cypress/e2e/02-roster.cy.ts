// ── 02 · Roster management ────────────────────────────────────────────────
// Tests adding a player manually and generating dummy players.

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

describe('Roster — manual player add', () => {
  beforeEach(() => {
    cy.clearAppState()
    if (!login()) return
    cy.visit('/')
    cy.contains('My Teams', { timeout: 12000 })
  })

  it('opens the Add Player form', () => {
    cy.get('.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]', { timeout: 8000 })
      .then($tiles => {
        if ($tiles.length === 0) {
          cy.log('⚠️  No assessments found in this account — skipping roster test')
          return
        }
        cy.wrap($tiles.first()).click()
        cy.contains(/add player/i, { timeout: 8000 }).should('be.visible')
      })
  })

  it('blocks submission when required fields are missing', () => {
    cy.get('.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]', { timeout: 8000 })
      .then($tiles => {
        if ($tiles.length === 0) {
          cy.log('⚠️  No assessments found in this account — skipping roster test')
          return
        }
        cy.wrap($tiles.first()).click()
        cy.contains(/add player/i, { timeout: 8000 }).click()
        cy.contains(/^(save|add|submit)/i).first().click()
        cy.contains(/required|please enter|missing/i, { timeout: 5000 }).should('be.visible')
      })
  })
})

describe('Roster — dummy player generation', () => {
  beforeEach(() => {
    cy.clearAppState()
    if (!login()) return
    cy.visit('/')
    cy.contains('My Teams', { timeout: 12000 })
  })

  it('generates 50 dummy players without freezing', () => {
    cy.get('.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]', { timeout: 8000 })
      .then($tiles => { if ($tiles.length === 0) { cy.log('⚠️  No assessments — skipping'); return } })
    cy.get('.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]')
      .first().click()

    // Open the dummy generator panel
    cy.contains(/generate|dummy|test data/i, { timeout: 8000 }).click()

    // Set skater count to 50
    cy.get('#randSkaterCount').clear().type('50')
    cy.get('#randGoalieCount').clear().type('0')

    // Click generate
    cy.contains(/generate players|start/i).click()

    // Progress bar should appear and complete within 30 seconds
    cy.get('#batchGenProgress', { timeout: 5000 }).should('be.visible')
    cy.get('#batchGenProgress', { timeout: 30000 }).should('not.be.visible')

    // Success banner
    cy.contains(/generated 50 players/i, { timeout: 5000 }).should('be.visible')
  })

  it('generates 200 dummy players without freezing', () => {
    cy.get('.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]', { timeout: 8000 })
      .then($tiles => { if ($tiles.length === 0) { cy.log('⚠️  No assessments — skipping'); return } })
    cy.get('.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]')
      .first().click()

    cy.contains(/generate|dummy|test data/i, { timeout: 8000 }).click()

    cy.get('#randSkaterCount').clear().type('200')
    cy.get('#randGoalieCount').clear().type('0')

    cy.contains(/generate players|start/i).click()

    cy.get('#batchGenProgress', { timeout: 5000 }).should('be.visible')
    // Allow up to 60 seconds for 200 players
    cy.get('#batchGenProgress', { timeout: 60000 }).should('not.be.visible')

    cy.contains(/generated 200 players/i, { timeout: 5000 }).should('be.visible')
  })
})
