// Cypress support file — loaded automatically before every spec.
import './commands'

// ── Per-test intercepts ────────────────────────────────────────────────────
beforeEach(() => {
  // 1. Force a fresh fetch of the root HTML on every visit — bypasses both
  //    browser cache and any stale Netlify CDN edge nodes that haven't yet
  //    propagated the latest deploy.
  cy.intercept('GET', '/', (req) => {
    req.headers['Cache-Control'] = 'no-cache, no-store'
    req.headers['Pragma']        = 'no-cache'
    req.continue()
  }).as('indexFresh')

  // 2. Block Netlify's injected RUM analytics script.  It's absent from local
  //    builds, async, and can fire uncaught exceptions inside Cypress's AUT
  //    iframe that have nothing to do with app correctness.
  cy.intercept('GET', '/.netlify/scripts/rum', {
    statusCode: 200,
    body:    '/* RUM blocked in tests */',
    headers: { 'content-type': 'application/javascript' },
  }).as('rumBlocked')

  // 3. Stub the Netlify Identity CDN widget.  The live page loads it
  //    dynamically when window.netlifyIdentity is not already defined (i.e.
  //    any test that doesn't call loginViaAPI).  Returning an empty script
  //    body would leave window.netlifyIdentity undefined and cause TypeErrors
  //    when the app tries to call .on()/.init().  Instead we return a minimal
  //    stub so the app starts cleanly and shows the signed-out state.
  cy.intercept('GET', 'https://identity.netlify.com/**', {
    statusCode: 200,
    body: `(function(){
      if (window.netlifyIdentity) return; // already set by loginViaAPI
      var handlers = {};
      window.netlifyIdentity = {
        on:  function(e,cb){ (handlers[e]=handlers[e]||[]).push(cb); },
        init:        function(){ (handlers['init']||[]).forEach(function(cb){ cb(null); }); },
        open:        function(){},
        close:       function(){},
        logout:      function(){ (handlers['logout']||[]).forEach(function(cb){ cb(); }); },
        currentUser: function(){ return null; },
        refresh:     function(){ return Promise.resolve(null); },
      };
      // Fire "init" with null user so the app renders the signed-out state.
      setTimeout(function(){ window.netlifyIdentity.init(); }, 0);
    })();`,
    headers: { 'content-type': 'application/javascript' },
  }).as('identityStubbed')
})

// ── Uncaught-exception handler ─────────────────────────────────────────────
// Logs the full stack trace to the Cypress command log before re-throwing so
// CI output has enough detail to diagnose regressions quickly.
Cypress.on('uncaughtException', (err) => {
  Cypress.log({
    name:         'uncaughtException',
    message:      err.message,
    consoleProps: () => ({ message: err.message, stack: err.stack }),
  })
  // true → Cypress still fails the test (default behaviour).
  return true
})
