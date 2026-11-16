import { useEffect, useId, useRef, useState } from 'react'
import { assessClaim } from '../api/assessClaim.js'
import { EXAMPLES, EXAMPLE_CLAIM } from '../samples.js'
import { AssessmentResult } from './AssessmentResult.jsx'

// These mirror the API's limits so people get a helpful message before sending. The server stays the source of truth.
const MAX_CLAIM_CHARS = 500
const MIN_EVIDENCE_CHARS = 20
const MAX_EVIDENCE_CHARS = 30000

function validate(claimText, evidenceText) {
  const errors = {}
  const claim = claimText.trim()
  const evidence = evidenceText.trim()

  if (!claim) {
    errors.claim = 'Enter the claim you want to check, for example "Reduces wrinkles by 20% in 4 weeks".'
  } else if (claim.length > MAX_CLAIM_CHARS) {
    errors.claim = `The claim must be ${MAX_CLAIM_CHARS} characters or fewer.`
  }

  if (!evidence) {
    errors.evidence = 'Paste the study results. The assessment needs the text of the study.'
  } else if (evidence.length < MIN_EVIDENCE_CHARS) {
    errors.evidence = `The study text is too short to assess. Enter at least ${MIN_EVIDENCE_CHARS} characters.`
  } else if (evidence.length > MAX_EVIDENCE_CHARS) {
    errors.evidence = `The study text is too long (${evidence.length.toLocaleString()} characters). The limit is ${MAX_EVIDENCE_CHARS.toLocaleString()}. Paste only the results section.`
  }
  return errors
}

/** The one screen: enter a claim and a study, press the button, read the answer. */
export function ClaimAssessment() {
  const base = useId()
  const claimInputId = `${base}-claim`
  const claimHintId = `${base}-claim-hint`
  const claimErrorId = `${base}-claim-error`
  const evidenceInputId = `${base}-evidence`
  const evidenceHintId = `${base}-evidence-hint`
  const evidenceErrorId = `${base}-evidence-error`

  const [claimText, setClaimText] = useState(EXAMPLE_CLAIM)
  const [evidenceText, setEvidenceText] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  // One of: { status: 'idle' } | { status: 'loading' } | { status: 'success', result } | { status: 'error', message }
  const [request, setRequest] = useState({ status: 'idle' })

  const claimRef = useRef(null)
  const evidenceRef = useRef(null)
  const inFlight = useRef(null)

  useEffect(() => () => inFlight.current?.abort(), []) // leaving the page cancels any call still running

  const loading = request.status === 'loading'

  async function handleSubmit(event) {
    event.preventDefault()
    if (loading) return // a double click must not start (and pay for) a second assessment

    const errors = validate(claimText, evidenceText)
    setFieldErrors(errors)
    if (errors.claim) return claimRef.current?.focus()
    if (errors.evidence) return evidenceRef.current?.focus()

    const controller = new AbortController()
    inFlight.current = controller
    setRequest({ status: 'loading' })
    try {
      const result = await assessClaim({
        claimText: claimText.trim(),
        evidenceText: evidenceText.trim(),
        signal: controller.signal,
      })
      setRequest({ status: 'success', result })
    } catch (error) {
      if (controller.signal.aborted) return // we cancelled it ourselves
      // Nothing the user typed is cleared: they should be able to just try again.
      setRequest({ status: 'error', message: error?.message || 'Something went wrong. Please try again.' })
    }
  }

  function loadExample(example) {
    setClaimText(EXAMPLE_CLAIM)
    setEvidenceText(example.text)
    setFieldErrors({})
    setRequest({ status: 'idle' })
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={handleSubmit} noValidate>
        <h2>Check a claim against a study</h2>

        <div className="field">
          <label htmlFor={claimInputId}>Claim</label>
          <p id={claimHintId} className="hint">
            The marketing statement to check.
          </p>
          <input
            ref={claimRef}
            id={claimInputId}
            type="text"
            autoComplete="off"
            value={claimText}
            onChange={(event) => setClaimText(event.target.value)}
            aria-invalid={Boolean(fieldErrors.claim)}
            aria-describedby={fieldErrors.claim ? `${claimHintId} ${claimErrorId}` : claimHintId}
          />
          {fieldErrors.claim && (
            <p id={claimErrorId} className="error">
              {fieldErrors.claim}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={evidenceInputId}>Study results</label>
          <p id={evidenceHintId} className="hint">
            Paste the results section or summary of the clinical study ({MIN_EVIDENCE_CHARS} to{' '}
            {MAX_EVIDENCE_CHARS.toLocaleString()} characters).
          </p>
          <textarea
            ref={evidenceRef}
            id={evidenceInputId}
            rows={10}
            value={evidenceText}
            onChange={(event) => setEvidenceText(event.target.value)}
            aria-invalid={Boolean(fieldErrors.evidence)}
            aria-describedby={fieldErrors.evidence ? `${evidenceHintId} ${evidenceErrorId}` : evidenceHintId}
          />
          {fieldErrors.evidence && (
            <p id={evidenceErrorId} className="error">
              {fieldErrors.evidence}
            </p>
          )}
        </div>

        <fieldset className="examples">
          <legend>Or load an example</legend>
          {EXAMPLES.map((example) => (
            <button key={example.id} type="button" className="button secondary" onClick={() => loadExample(example)}>
              {example.label}
            </button>
          ))}
        </fieldset>

        <div className="actions">
          <button type="submit" className="button primary" aria-disabled={loading}>
            {loading ? 'Assessing…' : 'Assess claim'}
          </button>
        </div>
      </form>

      {/* Always in the page, so a screen reader hears it appear. Empty when nothing is running. */}
      <div className="progress" role="status">
        {loading ? 'Assessing the claim. This usually takes a few seconds and can take up to two minutes.' : null}
      </div>

      {request.status === 'error' && (
        <div className="callout danger" role="alert">
          <strong>The claim could not be assessed.</strong> {request.message}
        </div>
      )}

      {request.status === 'success' && <AssessmentResult result={request.result} />}
    </div>
  )
}
