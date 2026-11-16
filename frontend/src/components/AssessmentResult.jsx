import { useEffect, useId, useRef } from 'react'

// Every status is shown as an icon AND a word, so nothing depends on colour alone.
const STATUS = {
  pass: { icon: '✓', word: 'Passed' },
  fail: { icon: '✕', word: 'Failed' },
  unknown: { icon: '?', word: 'Could not confirm' },
  not_applicable: { icon: '–', word: 'Not applicable' },
}

const weeks = (n) => `${Number(n.toFixed(1))} ${n === 1 ? 'week' : 'weeks'}`

/** What the evaluator sees after an assessment: the verdict, how sure we are, why, and the evidence behind it. */
export function AssessmentResult({ result }) {
  const headingId = useId()
  const confidenceId = useId()
  const checksId = useId()
  const headingRef = useRef(null)

  // The user just pressed "Assess claim". Move them to the answer so keyboard and screen-reader users land on it.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const percent = Math.round(result.confidence * 100)
  const claim = result.claimUnderstood

  return (
    <section className={`card result ${result.justified ? 'is-yes' : 'is-no'}`} aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>
        Assessment result
      </h2>

      <p className="verdict">
        <span className="verdict-icon" aria-hidden="true">
          {result.justified ? '✓' : '✕'}
        </span>
        <span>
          Justified: <strong>{result.justified ? 'Yes' : 'No'}</strong>
        </span>
      </p>

      <div className="confidence">
        <span id={confidenceId}>Confidence</span>
        <meter min={0} max={1} value={result.confidence} aria-labelledby={confidenceId} aria-valuetext={`${percent} percent`} />
        <span className="confidence-value">{percent}%</span>
      </div>

      {result.needsReview && (
        <div className="callout warn">
          <strong>Needs human review.</strong> The system is not sure enough, or its checks and the model disagree. An
          evaluator should look at this before the claim is used.
        </div>
      )}

      <h3>Reasoning</h3>
      <p>{result.reasoning}</p>

      <h3>How the claim was read</h3>
      <dl className="facts">
        <div>
          <dt>About</dt>
          <dd>{claim.metric}</dd>
        </div>
        <div>
          <dt>Direction</dt>
          <dd>{claim.direction === 'none' ? 'not stated' : claim.direction}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{claim.magnitudePercent === null ? 'not stated' : `${claim.magnitudePercent}%`}</dd>
        </div>
        <div>
          <dt>Within</dt>
          <dd>{claim.timeframeWeeks === null ? 'not stated' : weeks(claim.timeframeWeeks)}</dd>
        </div>
      </dl>

      <h3 id={checksId}>Checks</h3>
      <ul className="checks" aria-labelledby={checksId}>
        {result.checks.map((check) => {
          const status = STATUS[check.status] ?? STATUS.unknown
          return (
            <li key={check.id} className={`check is-${check.status}`}>
              <span className="check-icon" aria-hidden="true">
                {status.icon}
              </span>
              <div>
                <span className="check-status">{status.word}:</span> <strong>{check.label}</strong>
                {!check.critical && <span className="advisory"> (advisory)</span>}
                <span className="detail">{check.detail}</span>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="meta">
        Model {result.model} · prompt {result.promptVersion} ·{' '}
        <time dateTime={result.createdAt}>{new Date(result.createdAt).toLocaleString()}</time>
      </p>
    </section>
  )
}
