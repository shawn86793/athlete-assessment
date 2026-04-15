/**
 * In-memory rate limiter. Per-function-instance — not distributed across Netlify instances.
 * Suitable for burst protection within a single warm instance. For distributed rate limiting,
 * use a Redis/KV store.
 */

type Bucket = { count: number; resetAt: number }
const store = new Map<string, Bucket>()

/**
 * Returns true if the request is within the allowed rate, false if it should be blocked.
 * Increments the counter on each allowed call.
 */
export const allow = (key: string, maxRequests: number, windowMs: number): boolean => {
  const now = Date.now()
  const bucket = store.get(key)

  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (bucket.count >= maxRequests) return false
  bucket.count++
  return true
}

/** Returns standard rate-limit response headers for the given key. */
export const rateLimitHeaders = (key: string, maxRequests: number): Record<string, string> => {
  const bucket = store.get(key)
  if (!bucket) return {}
  return {
    'X-RateLimit-Limit': String(maxRequests),
    'X-RateLimit-Remaining': String(Math.max(0, maxRequests - bucket.count)),
    'X-RateLimit-Reset': String(Math.ceil(bucket.resetAt / 1000)),
  }
}

/** Prune expired buckets to prevent unbounded memory growth on long-lived instances. */
export const pruneExpired = () => {
  const now = Date.now()
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key)
  }
}
