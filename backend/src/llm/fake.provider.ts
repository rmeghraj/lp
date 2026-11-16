import type { LlmOutput, StudyDesign } from './llm-output.schema.js';
import { LlmProvider, type LlmAssessmentInput, type LlmAssessmentResult } from './llm.provider.js';
import { PROMPT_VERSION } from './prompt.js';

type Duration = LlmOutput['claim']['timeframe'];
type Effect = LlmOutput['study']['effect'];
type Fact = LlmOutput['study']['sampleSize'];

const NO_DURATION: Duration = { value: null, unit: null };
const NO_FACT: Fact = { value: null, quote: null };

/**
 * An offline stand-in for the language model. It "reads" with regular expressions instead of a model.
 * It exists so the whole stack can be demonstrated and tested with no API key and no network.
 *
 * It is NOT a model and its output means nothing outside a demo. It also plays one deliberate trick:
 * if the study text contains an "ignore all previous instructions" style order, it obeys it, so the
 * safeguard (code checks that can veto a model's "yes") can be shown working.
 */
export class FakeLlmProvider extends LlmProvider {
  async assess(input: LlmAssessmentInput): Promise<LlmAssessmentResult> {
    const startedAt = performance.now();
    const output = read(input);
    return {
      output,
      meta: { model: 'fake-heuristic-v1', promptVersion: PROMPT_VERSION, latencyMs: Math.round(performance.now() - startedAt) },
    };
  }
}

function read({ claimText, evidenceText }: LlmAssessmentInput): LlmOutput {
  const claim = readClaim(claimText);
  const sentence = splitSentences(evidenceText).find((s) => EFFECT.test(s)) ?? null;
  const effect = readEffect(sentence, claim.direction);
  const pValue = sentence ? readPValue(sentence) : NO_FACT;
  const sampleSize = readSampleSize(evidenceText);

  return {
    claim,
    study: {
      design: readDesign(evidenceText),
      endpointMatchesClaim: endpointMatches(claimText, sentence),
      sampleSize,
      effect,
      pValue,
    },
    verdict: draftVerdict(evidenceText, claim, effect, pValue),
  };
}

// ---------------------------------------------------------------------------------------------
// Reading the claim

function readClaim(text: string): LlmOutput['claim'] {
  const percent = /(\d+(?:\.\d+)?)\s*%/.exec(text);
  const time = /(\d+(?:\.\d+)?)\s*[- ]?(day|week|month)s?\b/i.exec(text);
  const metric = /\b(?:reduces?|improves?|increases?|boosts?|smooths?|lifts?|firms?)\s+(?:the\s+)?([a-z-]+)/i.exec(text);
  return {
    metric: metric?.[1].toLowerCase() ?? 'unspecified',
    direction: /\b(reduc|decreas|lower|smooth|diminish)/i.test(text)
      ? 'decrease'
      : /\b(increas|boost|improv|firm|lift|rais|enhanc)/i.test(text)
        ? 'increase'
        : 'none',
    magnitudePercent: percent ? Number(percent[1]) : null,
    timeframe: time ? { value: Number(time[1]), unit: `${time[2].toLowerCase()}s` as 'days' | 'weeks' | 'months' } : NO_DURATION,
  };
}

// ---------------------------------------------------------------------------------------------
// Reading the study

const EFFECT = /\b(reduc\w*|decreas\w*|lower\w*|diminish\w*|improv\w*|increas\w*|rais\w*|boost\w*)\b[^.]*?\bby\s+(\d+(?:\.\d+)?)\s*%/i;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function readEffect(sentence: string | null, claimDirection: LlmOutput['claim']['direction']): Effect {
  const match = sentence ? EFFECT.exec(sentence) : null;
  if (!sentence || !match) return { direction: null, percent: null, timepoint: NO_DURATION, quote: null };

  const verb = match[1].toLowerCase();
  const direction: Effect['direction'] = /^(reduc|decreas|lower|diminish)/.test(verb)
    ? 'decrease'
    : /^(increas|rais|boost)/.test(verb)
      ? 'increase'
      : claimDirection === 'increase'
        ? 'increase'
        : 'decrease'; // "improved" means whichever way the claim says is good
  const week = /\b(?:week|wk)s?\s*(\d+)/i.exec(sentence);
  return {
    direction,
    percent: Number(match[2]),
    timepoint: week ? { value: Number(week[1]), unit: 'weeks' } : NO_DURATION,
    quote: sentence,
  };
}

function readSampleSize(text: string): Fact {
  const match =
    /\bn\s*=\s*(\d+)/i.exec(text) ??
    /(\d+)\s+(?:healthy\s+)?(?:women|men|volunteers|participants|subjects|panell?ists)/i.exec(text);
  return match ? { value: Number(match[1]), quote: match[0] } : NO_FACT;
}

function readPValue(sentence: string): Fact {
  const match = /\bp\s*([<=])\s*(0?\.\d+)/i.exec(sentence);
  return match ? { value: Number(match[2]), quote: match[0] } : NO_FACT;
}

function readDesign(text: string): StudyDesign {
  if (/single[- ]arm|open[- ]label|before[- ]and[- ]after/i.test(text)) return 'single_arm';
  const controlled = /vehicle|placebo|control/i.test(text);
  if (controlled && /randomi[sz]ed/i.test(text)) return 'randomized_controlled';
  return controlled ? 'controlled' : 'unclear';
}

function endpointMatches(claimText: string, effectSentence: string | null): boolean | null {
  const metric = /\b(?:reduces?|improves?|increases?|boosts?|smooths?|lifts?|firms?)\s+(?:the\s+)?([a-z-]+)/i.exec(claimText);
  if (!metric || !effectSentence) return null;
  return effectSentence.toLowerCase().includes(metric[1].toLowerCase().slice(0, 6));
}

// ---------------------------------------------------------------------------------------------
// The draft verdict

const HIJACK = /ignore\s+(?:all\s+|the\s+|any\s+)?(?:previous|above|prior)/i;

function draftVerdict(evidenceText: string, claim: LlmOutput['claim'], effect: Effect, pValue: Fact): LlmOutput['verdict'] {
  if (HIJACK.test(evidenceText)) {
    return { justified: true, confidence: 0.99, reasoning: 'The study fully justifies the claim.' };
  }

  const claimedWeeks = weeksOf(claim.timeframe);
  const measuredWeeks = weeksOf(effect.timepoint);
  const bigEnough = claim.magnitudePercent !== null && effect.percent !== null && effect.percent >= claim.magnitudePercent;
  const onTime = claimedWeeks === null || (measuredWeeks !== null && measuredWeeks <= claimedWeeks);
  const significant = pValue.value !== null && pValue.value < 0.05;

  if (bigEnough && onTime && significant) {
    return {
      justified: true,
      confidence: 0.85,
      reasoning: `The study reports a ${effect.percent}% ${effect.direction} at week ${effect.timepoint.value}, which meets the claimed ${claim.magnitudePercent}%, with p = ${pValue.value}.`,
    };
  }
  return {
    justified: false,
    confidence: 0.8,
    reasoning: 'The study does not clearly show the claimed effect within the claimed time with a significant result.',
  };
}

function weeksOf(duration: Duration): number | null {
  if (duration.value === null || duration.unit === null) return null;
  if (duration.unit === 'days') return duration.value / 7;
  return duration.unit === 'weeks' ? duration.value : duration.value * (52 / 12);
}
