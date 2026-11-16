import type { LlmOutput } from '../../llm/llm-output.schema.js';
import type { FactName, Facts } from './types.js';

const WEEKS_PER_MONTH = 52 / 12;

type Duration = LlmOutput['claim']['timeframe'];

/**
 * Turns the model's extraction into facts we are willing to compute with.
 * A number survives only if the model quoted the source for it and the quote really is in the source.
 * Anything else becomes null ("unknown") and the reason is recorded in `problems`.
 */
export function verifyFacts(output: LlmOutput, source: { claimText: string; evidenceText: string }): Facts {
  const problems: Facts['problems'] = {};
  const evidence = normalise(source.evidenceText);
  const claimNumbers = numbersIn(source.claimText);

  const quoteProblem = (quote: string | null): string | null => {
    const wanted = quote === null ? '' : normalise(quote);
    if (wanted === '') return 'The model gave no supporting quote';
    return evidence.includes(wanted) ? null : 'The quoted text was not found in the study';
  };

  const quoted = <T>(name: FactName, value: T | null, quote: string | null): T | null => {
    if (value === null) return null;
    const problem = quoteProblem(quote);
    if (problem) {
      problems[name] = problem;
      return null;
    }
    return value;
  };

  const writtenInClaim = (name: FactName, value: number | null): number | null => {
    if (value === null) return null;
    if (claimNumbers.some((n) => Math.abs(n - value) < 1e-9)) return value;
    problems[name] = `The number ${value} does not appear in the claim text`;
    return null;
  };

  const { claim, study } = output;

  const timeframeValue = writtenInClaim('claimTimeframe', claim.timeframe.value);
  // Direction, size and timing all come from one sentence, so they stand or fall together.
  const effectHasContent =
    study.effect.percent !== null || study.effect.direction !== null || study.effect.timepoint.value !== null;
  const effectQuoted = effectHasContent ? quoted('effect', true, study.effect.quote) : null;

  return {
    claim: {
      metric: claim.metric,
      direction: claim.direction,
      magnitudePercent: writtenInClaim('claimMagnitude', claim.magnitudePercent),
      timeframeWeeks: timeframeValue === null ? null : toWeeks(claim.timeframe),
    },
    study: {
      design: study.design,
      endpointMatchesClaim: study.endpointMatchesClaim,
      sampleSize: quoted('sampleSize', study.sampleSize.value, study.sampleSize.quote),
      effect: effectQuoted
        ? { direction: study.effect.direction, percent: study.effect.percent, timepointWeeks: toWeeks(study.effect.timepoint) }
        : { direction: null, percent: null, timepointWeeks: null },
      pValue: quoted('pValue', study.pValue.value, study.pValue.quote),
    },
    problems,
  };
}

/** Lower-case, collapse whitespace and straighten typography so harmless formatting differences still match. */
function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'") // curly apostrophes
    .replace(/[\u201c\u201d]/g, '"') // curly double quotes
    .replace(/[\u2010-\u2015\u2212]/g, '-') // dashes (hyphen to horizontal bar) and the unicode minus sign
    .replace(/[\u200b-\u200d\ufeff]/g, '') // zero-width characters
    .replace(/\s+/g, ' ')
    .trim();
}

function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));
}

function toWeeks(duration: Duration): number | null {
  if (duration.value === null || duration.unit === null) return null;
  switch (duration.unit) {
    case 'days':
      return duration.value / 7;
    case 'weeks':
      return duration.value;
    case 'months':
      return duration.value * WEEKS_PER_MONTH;
  }
}
