import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, assessClaim, REQUEST_TIMEOUT_MS } from './assessClaim.js'

const reply = (status, body) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' },
  })

const input = { claimText: 'Reduces wrinkles by 20% in 4 weeks', evidenceText: 'Study text' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('assessClaim', () => {
  it('posts the claim and the study text as JSON and returns the assessment', async () => {
    const assessment = { id: 'a1', justified: true }
    const fetchMock = vi.fn().mockResolvedValue(reply(201, assessment))
    vi.stubGlobal('fetch', fetchMock)

    const result = await assessClaim(input)

    expect(result).toEqual(assessment)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/claims/assess')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      claim: { text: 'Reduces wrinkles by 20% in 4 weeks' },
      evidence: { text: 'Study text' },
    })
  })

  it('turns the API list of validation problems into one readable message', async () => {
    const body = { statusCode: 400, message: ['evidence.text: Too small', 'claim.text: Required'] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(400, body)))

    const failure = await assessClaim(input).catch((e) => e)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure.status).toBe(400)
    expect(failure.message).toContain('evidence.text: Too small')
    expect(failure.message).toContain('claim.text: Required')
  })

  it('uses the message the service gives for its own errors', async () => {
    const message = 'The assessment service is temporarily unavailable. Please try again in a moment.'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(503, { statusCode: 503, message })))

    const failure = await assessClaim(input).catch((e) => e)

    expect(failure.message).toBe(message)
    expect(failure.status).toBe(503)
  })

  it('never shows a raw error page when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(502, '<html><body>Bad gateway</body></html>')))

    const failure = await assessClaim(input).catch((e) => e)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure.status).toBe(502)
    expect(failure.message).not.toContain('<html>')
  })

  it('explains a network failure in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const failure = await assessClaim(input).catch((e) => e)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure.message).toMatch(/could not reach/i)
  })

  it('gives up with a clear message when the service takes too long', async () => {
    vi.useFakeTimers()
    // A fetch that never answers, but honours cancellation like the real one.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          }),
      ),
    )

    const pending = assessClaim(input).catch((e) => e)
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)

    const failure = await pending
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure.message).toMatch(/taking too long/i)
  })

  it('lets the caller cancel, and passes the cancellation through untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          }),
      ),
    )
    const controller = new AbortController()

    const pending = assessClaim({ ...input, signal: controller.signal }).catch((e) => e)
    controller.abort()

    const failure = await pending
    expect(failure.name).toBe('AbortError')
    expect(failure).not.toBeInstanceOf(ApiError)
  })
})
