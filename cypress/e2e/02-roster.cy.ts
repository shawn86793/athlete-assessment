// ── 02 · Roster management ────────────────────────────────────────────────
// Tests adding a player manually and generating dummy players.

const TILE_SEL = '.assessmentTile, .teamTile, [onclick*="openAssessment"], [onclick*="openTryout"]'

const login = () => {
  const email = Cypress.env('COACH_EMAIL')
  const pass  = Cypress.env('COACH_PASSWORD')
  if (!email || !pass || pass === 'YOUR_PASSWORD_HERE') return false
  cy.loginViaAPI(email, pass)
  return true
}

/** Returns true if assessment tiles exist on the current page. */
const hasTiles = ($body: JQuery<HTMLElement>) =>
  $body.find(TILE_SEL).length > 0

describe('Roster — manual player add', () => {
  beforeEach(() => {
    cy.clearAppState()
    if (!login()) return
    // loginViaAPI already navigated to '/' with session pre-loaded
    cy.contains('My Teams', { timeout: 20000 })
  })

  it('opens the Add Player form', () => {
    cy.get('body').then($body => {
      if (!hasTiles($body)) {
        cy.log('⚠️  No assessments found in this account — skipping roster test')
        return
      }
      cy.get(TILE_SEL).first().click()
      cy.contains(/add player/i, { timeout: 8000 }).should('be.visible')
    })
  })

  it('blocks submission when required fields are missing', () => {
    cy.get('body').then($body => {
      if (!hasTiles($body)) {
        cy.log('⚠️  No assessments found in this account — skipping roster test')
        return
      }
      cy.get(TILE_SEL).first().click()
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
    // loginViaAPI already navigated to '/' with session pre-loaded
    cy.contains('My Teams', { timeout: 20000 })
  })

  it('generates 50 dummy players without freezing', () => {
    cy.get('body').then($body => {
      if (!hasTiles($body)) {
        cy.log('⚠️  No assessments — skipping')
        return
      }
      cy.get(TILE_SEL).first().click()
      cy.contains(/generate|dummy|test data/i, { timeout: 8000 }).click()
      cy.get('#randSkaterCount').clear().type('50')
      cy.get('#randGoalieCount').clear().type('0')
      cy.contains(/generate players|start/i).click()
      cy.get('#batchGenProgress', { timeout: 5000 }).should('be.visible')
      cy.get('#batchGenProgress', { timeout: 30000 }).should('not.be.visible')
      cy.contains(/generated 50 players/i, { timeout: 5000 }).should('be.visible')
    })
  })

  it('generates 200 dummy players without freezing', () => {
    cy.get('body').then($body => {
      if (!hasTiles($body)) {
        cy.log('⚠️  No assessments — skipping')
        return
      }
      cy.get(TILE_SEL).first().click()
      cy.contains(/generate|dummy|test data/i, { timeout: 8000 }).click()
      cy.get('#randSkaterCount').clear().type('200')
      cy.get('#randGoalieCount').clear().type('0')
      cy.contains(/generate players|start/i).click()
      cy.get('#batchGenProgress', { timeout: 5000 }).should('be.visible')
      cy.get('#batchGenProgress', { timeout: 60000 }).should('not.be.visible')
      cy.contains(/generated 200 players/i, { timeout: 5000 }).should('be.visible')
    })
  })
})
