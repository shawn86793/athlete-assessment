// Cypress support file — loaded automatically before every spec.
import './commands'

// ── Block Netlify-injected analytics scripts ───────────────────────────────
// The live site has a <script async src="/.netlify/scripts/rum"> injected by
// Netlify's CDN (Real-User-Monitoring). It is not present in local builds,
// not under our control, and can fire async exceptions inside Cypress's AUT
// iframe. Stubbing it out keeps test results clean and deterministic.
beforeEach(() => {
  cy.intercept('GET', '/.netlify/scripts/rum', {
    statusCode: 200,
    body: '/* RUM blocked in tests */',
    headers: { 'content-type': 'application/javascript' },
  }).as('rumBlocked')
})

// ── Uncaught-exception handler ─────────────────────────────────────────────
// Default Cypress behaviour: fail the test but print only the message.
// This handler adds the full stack trace to the Cypress log so CI output
// has enough information to diagnose future regressions.
Cypress.on('uncaughtException', (err) => {
  // Log the full stack so it appears in the Cypress command log / CI output.
  Cypress.log({
    name: 'uncaughtException',
    message: err.message,
    consoleProps: () => ({ message: err.message, stack: err.stack }),
  })
  // Return true → Cypress still fails the test (default). Change to false to
  // swallow errors from third-party scripts outside our control.
  return true
})
