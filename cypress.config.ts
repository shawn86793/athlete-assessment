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

    setupNodeEvents(on) {
      // ── netlifyIdentityToken task ────────────────────────────────────────
      // Makes the POST /token request in Node.js (not the browser) so:
      //  • No CORS restrictions
      //  • Errors are caught with try/catch — always resolves, never throws
      //  • A null return signals the caller to fall back to a synthetic session
      on('task', {
        async netlifyIdentityToken({
          baseUrl,
          email,
          password,
        }: {
          baseUrl: string
          email: string
          password: string
        }): Promise<Record<string, unknown> | null> {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 6000)
          try {
            const res = await fetch(baseUrl + '/.netlify/identity/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'password',
                username: email,
                password,
              }).toString(),
              signal: controller.signal,
            })
            clearTimeout(timer)
            if (!res.ok) return null
            return (await res.json()) as Record<string, unknown>
          } catch {
            clearTimeout(timer)
            return null
          }
        },
      })
    },

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
