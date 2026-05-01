/**
 * AAS Service Worker — stale-while-revalidate for HTML, cache-first for assets
 * Version is embedded so bumping it forces cache invalidation on deploy.
 */
const SW_VERSION   = "aas-2026-04-30-v1";
const CACHE_HTML   = SW_VERSION + "-html";
const CACHE_ASSETS = SW_VERSION + "-assets";

// Static assets to pre-cache on install (small, always needed)
const PRECACHE_ASSETS = [
  "/assets/tryout_t_icon-128.webp",
  "/assets/tryout-main-logo-optimized.webp",
];

// ── Install: pre-cache critical assets ───────────────────────────────────────
self.addEventListener("install", function(ev) {
  ev.waitUntil(
    caches.open(CACHE_ASSETS)
      .then(function(cache) { return cache.addAll(PRECACHE_ASSETS); })
      .catch(function() { /* non-fatal if offline at install */ })
  );
  self.skipWaiting(); // activate immediately without waiting for old tabs to close
});

// ── Activate: purge stale caches from previous deploys ────────────────────────
self.addEventListener("activate", function(ev) {
  ev.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE_HTML && k !== CACHE_ASSETS; })
          .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim(); // take control of all open tabs immediately
});

// ── Fetch: smart routing strategies ──────────────────────────────────────────
self.addEventListener("fetch", function(ev) {
  var req = ev.request;
  // Only intercept GET requests
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch(e) { return; }

  // Skip cross-origin requests (fonts, CDN libraries loaded on demand)
  if (url.origin !== self.location.origin) return;

  // Skip Netlify functions / API routes
  if (url.pathname.startsWith("/.netlify/") || url.pathname.startsWith("/api/")) return;

  // Static assets (/assets/*) — cache-first, long-lived
  if (url.pathname.startsWith("/assets/")) {
    ev.respondWith(cacheFirst(req, CACHE_ASSETS));
    return;
  }

  // HTML pages (/ or /index.html or /admin.html or /register.html)
  // Strategy: stale-while-revalidate — serve cached immediately, update in background
  if (
    url.pathname === "/" ||
    url.pathname.endsWith(".html") ||
    url.pathname === "/admin" ||
    url.pathname === "/register"
  ) {
    ev.respondWith(staleWhileRevalidate(req, CACHE_HTML));
    return;
  }

  // Everything else — network with cache fallback
  ev.respondWith(networkWithCacheFallback(req));
});

// ── Caching strategies ────────────────────────────────────────────────────────

/** Serve from cache; if absent fetch, store, and return. */
async function cacheFirst(req, cacheName) {
  var cache   = await caches.open(cacheName);
  var cached  = await cache.match(req);
  if (cached) return cached;
  try {
    var fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch(e) {
    return cached || new Response("Offline", { status: 503 });
  }
}

/**
 * Return cached response immediately if available (fast),
 * then kick off a background network request to update the cache.
 * On first visit (no cache), falls through to network.
 */
async function staleWhileRevalidate(req, cacheName) {
  var cache  = await caches.open(cacheName);
  var cached = await cache.match(req);

  // Background revalidation — don't await, fire and forget
  var revalidation = fetch(req).then(function(fresh) {
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  }).catch(function() { return null; });

  // Serve stale immediately if we have it, otherwise wait for network
  return cached || revalidation;
}

/** Try network first; fall back to cache on failure. */
async function networkWithCacheFallback(req) {
  var cache = await caches.open(CACHE_ASSETS);
  try {
    var fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch(e) {
    var cached = await cache.match(req);
    return cached || new Response("Offline", { status: 503 });
  }
}
