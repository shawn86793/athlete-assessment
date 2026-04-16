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
    // Click into an assessment first
    cy.get('.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]', { timeout: 8000 })
      .first().click()
    // Add Player button / form should appear
    cy.contains(/add player/i, { timeout: 8000 }).should('be.visible')
  })

  it('blocks submission when required fields are missing', () => {
    cy.get('.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]', { timeout: 8000 })
      .first().click()
    // Open the add player form
    cy.contains(/add player/i, { timeout: 8000 }).click()
    // Try to submit empty — look for a Save/Add button
    cy.contains(/^(save|add|submit)/i).first().click()
    // Should show an error or stay on the form (not navigate away)
    cy.contains(/required|please enter|missing/i, { timeout: 5000 }).should('be.visible')
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
