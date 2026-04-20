import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    // Default: test against production. Override locally with:
    //   npx cypress open --config baseUrl=http://localhost:8888
    baseUrl: 'https://athleteassessmentsystems.netlify.app',

    specPattern: 'cypress/e2e/**/*.cy.{ts,js}',
    supportFile: 'cypress/support/e2e.ts',

    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 10000,

    // The production site sends X-Frame-Options: DENY which blocks Cypress
    // from loading the app inside its own iframe-based test runner.
    // chromeWebSecurity: false tells Chrome to ignore framing restrictions
    // during test runs only — has no effect on production behaviour.
    chromeWebSecurity: false,

    env: {
      // Set real values in cypress.env.json (gitignored) — never commit passwords
      // {
      //   "COACH_EMAIL": "your-coach@email.com",
      //   "COACH_PASSWORD": "yourpassword",
      //   "ADMIN_EMAIL": "shawngilbert047@gmail.com",
      //   "ADMIN_PASSWORD": "yourpassword"
      // }
      COACH_EMAIL: '',
      COACH_PASSWORD: '',
      ADMIN_EMAIL: 'shawngilbert047@gmail.com',
      ADMIN_PASSWORD: '',
    },
  },
})
