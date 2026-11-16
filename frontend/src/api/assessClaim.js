// Empty in development (Vite proxies /api to the backend). Set VITE_API_BASE_URL when the API lives elsewhere.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

/**
 * How long the UI waits before giving up. A model call usually takes seconds, but the server may retry
 * once or twice before it answers, so this is generous. The server saves nothing if it fails.
 */
export const REQUEST_TIMEOUT_MS = 120_000

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * POST /api/claims/assess. Resolves with the assessment, or rejects with an ApiError whose message is
 * safe to show to a person. If the caller cancels through `signal`, the AbortError is passed through
 * untouched so the caller can tell "I cancelled" from "it failed".
 */
export async function assessClaim({ claimText, evidenceText, signal }) {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    let response
    try {
      response = await fetch(`${API_BASE}/api/claims/assess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim: { text: claimText }, evidence: { text: evidenceText } }),
        signal: controller.signal,
      })
    } catch (error) {
      if (timedOut) throw new ApiError('The assessment is taking too long. Please try again.')
      if (signal?.aborted) throw error
      throw new ApiError('Could not reach the assessment service. Check your connection and try again.')
    }

    let body
    try {
      body = await response.json()
    } catch {
      body = null // an error page from a proxy, for example, is not JSON
    }

    if (!response.ok) throw new ApiError(messageFrom(body, response.status), response.status)
    if (body === null || typeof body !== 'object') {
      throw new ApiError('The assessment service sent an answer that could not be read. Please try again.', response.status)
    }
    return body
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

function messageFrom(body, status) {
  const message = body?.message
  if (Array.isArray(message) && message.length > 0) return message.join('; ')
  if (typeof message === 'string' && message.length > 0) return message
  return `The assessment service returned an unexpected error (HTTP ${status}). Please try again.`
}
