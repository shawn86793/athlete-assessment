const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export type RetryOptions = {
  maxAttempts: number
  baseDelayMs: number
  onRetry?: (attempt: number, error: unknown) => void
}

/**
 * Retries an async operation with exponential backoff.
 * Throws the last error if all attempts fail.
 */
export const withRetry = async <T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> => {
  const { maxAttempts, baseDelayMs, onRetry } = opts
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      onRetry?.(attempt, err)
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelayMs * Math.pow(2, attempt))
      }
    }
  }
  throw lastError
}

/**
 * Retries an ETag-based optimistic-concurrency operation.
 * The callback must return `{ value, conflict: true }` on ETag mismatch
 * or `{ value, conflict: false }` on success.
 * Returns the value on success, or throws after exhausting all attempts.
 */
export const withEtagRetry = async <T>(
  fn: () => Promise<{ value: T; conflict: boolean }>,
  opts: RetryOptions,
): Promise<T> => {
  const { maxAttempts, baseDelayMs, onRetry } = opts
  let attempt = 0
  for (; attempt < maxAttempts; attempt++) {
    const { value, conflict } = await fn()
    if (!conflict) return value
    onRetry?.(attempt, new Error('etag-conflict'))
    if (attempt < maxAttempts - 1) {
      await sleep(baseDelayMs * Math.pow(2, attempt))
    }
  }
  throw new Error(`ETag conflict unresolved after ${maxAttempts} attempts`)
}
