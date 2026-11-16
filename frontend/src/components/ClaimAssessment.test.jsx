import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaimAssessment } from './ClaimAssessment.jsx'

const STUDY =
  'Randomised vehicle-controlled study of 45 women. At week 4, wrinkle depth was reduced by 23% from baseline (p = 0.003).'

const assessment = (overrides = {}) => ({
  id: 'a1',
  claimId: 'c1',
  justified: true,
  confidence: 0.85,
  needsReview: false,
  reasoning: 'The study reports a 23% decrease at week 4.',
  claimUnderstood: { metric: 'wrinkles', direction: 'decrease', magnitudePercent: 20, timeframeWeeks: 4 },
  checks: [
    {
      id: 'effect_size',
      label: 'Effect reaches the claimed size',
      critical: true,
      status: 'pass',
      detail: 'Observed 23% decrease; the claim needs at least 20%.',
    },
    {
      id: 'significance',
      label: 'Result is statistically significant',
      critical: true,
      status: 'unknown',
      detail: 'No p-value is stated.',
    },
    {
      id: 'control_group',
      label: 'Compared with a control group',
      critical: false,
      status: 'fail',
      detail: 'No control group.',
    },
  ],
  model: 'test-model',
  promptVersion: 'assess-claim@1',
  createdAt: '2026-11-14T10:00:00.000Z',
  ...overrides,
})

const reply = (status, body) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

function stubFetch(responder) {
  const fetchMock = vi.fn(responder)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const claimBox = () => screen.getByLabelText('Claim')
const studyBox = () => screen.getByLabelText('Study results')
const assessButton = () => screen.getByRole('button', { name: /assess claim|assessing/i })

async function pasteStudy(user, text = STUDY) {
  await user.click(studyBox())
  await user.paste(text)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ClaimAssessment', () => {
  it('shows the verdict, confidence and reasoning after a successful assessment', async () => {
    const fetchMock = stubFetch(() => reply(201, assessment()))
    const user = userEvent.setup()
    render(<ClaimAssessment />)

    await pasteStudy(user)
    await user.click(assessButton())

    const result = await screen.findByRole('region', { name: /assessment result/i })
    expect(within(result).getByText(/Justified:/)).toBeVisible()
    expect(within(result).getByText('Yes')).toBeVisible()
    expect(within(result).getByText('85%')).toBeVisible()
    expect(within(result).getByRole('meter', { name: /confidence/i })).toHaveValue(0.85)
    expect(within(result).getByText('The study reports a 23% decrease at week 4.')).toBeVisible()
    expect(within(result).getByRole('heading', { name: /assessment result/i })).toHaveFocus()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.evidence.text).toBe(STUDY)
    expect(body.claim.text).toBe('Reduces wrinkles by 20% in 4 weeks') // the pre-filled example claim
  })

  it('shows "No" and a human-review notice when the assessment is flagged', async () => {
    stubFetch(() => reply(201, assessment({ justified: false, needsReview: true, confidence: 0.5 })))
    const user = userEvent.setup()
    render(<ClaimAssessment />)

    await pasteStudy(user)
    await user.click(assessButton())

    const result = await screen.findByRole('region', { name: /assessment result/i })
    expect(within(result).getByText('No')).toBeVisible()
    expect(within(result).getByText('50%')).toBeVisible()
    expect(within(result).getByText(/needs human review/i)).toBeVisible()
  })

  it('does not show a review notice when the assessment is not flagged', async () => {
    stubFetch(() => reply(201, assessment()))
    const user = userEvent.setup()
    render(<ClaimAssessment />)

    await pasteStudy(user)
    await user.click(assessButton())

    await screen.findByRole('region', { name: /assessment result/i })
    expect(screen.queryByText(/needs human review/i)).not.toBeInTheDocument()
  })

  it('names every check with words, not colour alone, and marks the advisory one', async () => {
    stubFetch(() => reply(201, assessment()))
    const user = userEvent.setup()
    render(<ClaimAssessment />)

    await pasteStudy(user)
    await user.click(assessButton())

    const items = within(await screen.findByRole('list', { name: /checks/i })).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent(/passed.*effect reaches the claimed size/i)
    expect(items[1]).toHaveTextContent(/could not confirm.*statistically significant/i)
    expect(items[2]).toHaveTextContent(/failed.*control group.*advisory/i)
  })

  it('shows how the claim was read, so a misreading is easy to spot', async () => {
    stubFetch(() => reply(201, assessment()))
    const user = userEvent.setup()
    render(<ClaimAssessment />)

    await pasteStudy(user)
    await user.click(assessButton())

    const result = await screen.findByRole('region', { name: /assessment result/i })
    expect(within(result).getByText('wrinkles')).toBeVisible()
    expect(within(result).getByText('20%')).toBeVisible()
    expect(within(result).getByText(/4 weeks/)).toBeVisible()
  })

  it('asks for the missing study text in words tied to the field, keeps what was typed, and does not call the API', async () => {
    const fetchMock = stubFetch(() => reply(201, assessment()))
    const user = userEvent.setup()
    render(<ClaimAssessment />)

    await user.click(assessButton())

    expect(fetchMock).not.toHaveBeenCalled()
    const study = studyBox()
    expect(study).toBeInvalid()
    expect(study).toHaveFocus()
    expect(study).toHaveAccessibleDescription(/paste the study results/i)
    expect(claimBox()).toHaveValue('Reduces wrinkles by 20% in 4 weeks')
  })

  it('asks for a claim when it is blank', async () => {
    const fetchMock = stubFetch(() => reply(201, assessment()))
    const user = userEvent.setup()
    render(<ClaimAssessment />)

    await user.clear(claimBox())
    await pasteStudy(user)
    await user.click(assessButton())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(claimBox()).toBeInvalid()
    expect(claimBox()).toHaveFocus()
    expect(claimBox()).toHaveAccessibleDescription(/enter the claim/i)
    expect(studyBox()).toHaveValue(STUDY) // nothing is lost
  })

  it('stops calling a field invalid once the user has fixed it and resubmitted', async () => {
    stubFetch(() => reply(201, assessment()))
    const user = userEvent.setup()
    render(<ClaimAssessment />)

    await user.click(assessButton())
    expect(studyBox()).toBeInvalid()
    await pasteStudy(user)
    await user.click(assessButton())

    await screen.findByRole('region', { name: /assessment result/i })
    expect(studyBox()).toBeValid()
  })

  it('shows a service error in an alert and keeps everything the user typed', async () => {
    const message = 'The assessment service is temporarily unavailable. Please try again in a moment.'
    stubFetch(() => reply(503, { statusCode: 503, message }))
    const user = userEvent.setup()
    render(<ClaimAssessment />)

    await pasteStudy(user)
    await user.click(assessButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(studyBox()).toHaveValue(STUDY)
    expect(screen.queryByRole('region', { name: /assessment result/i })).not.toBeInTheDocument()
  })

  it('says that work is in progress, and ignores a second click while it runs', async () => {
    let finish
    const fetchMock = stubFetch(() => new Promise((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    render(<ClaimAssessment />)

    await pasteStudy(user)
    await user.click(assessButton())

    expect(screen.getByRole('status')).toHaveTextContent(/assessing/i)
    expect(assessButton()).toHaveAttribute('aria-disabled', 'true')
    await user.click(assessButton())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    finish(new Response(JSON.stringify(assessment()), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    await screen.findByRole('region', { name: /assessment result/i })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('does not leave an old result on screen while a new one is being worked out', async () => {
    let serverStopsAnswering = false
    stubFetch(() => (serverStopsAnswering ? new Promise(() => {}) : reply(201, assessment())))
    const user = userEvent.setup()
    render(<ClaimAssessment />)

    await pasteStudy(user)
    await user.click(assessButton())
    await screen.findByRole('region', { name: /assessment result/i })

    serverStopsAnswering = true
    await user.click(assessButton())

    expect(screen.queryByRole('region', { name: /assessment result/i })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/assessing/i)
  })

  it('fills the form from an example study, and replaces what was there', async () => {
    const user = userEvent.setup()
    render(<ClaimAssessment />)
    await user.clear(claimBox())
    await user.type(claimBox(), 'Something else')

    await user.click(screen.getByRole('button', { name: 'Strong study' }))

    expect(studyBox().value).toContain('Study CS-2417')
    expect(claimBox()).toHaveValue('Reduces wrinkles by 20% in 4 weeks')
  })
})
