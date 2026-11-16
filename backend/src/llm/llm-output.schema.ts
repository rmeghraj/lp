import { z } from 'zod';

/**
 * What we ask the model to return. Sent to OpenAI as a strict JSON schema (Structured Outputs) and
 * validated again on the way back, because "the right shape" is not the same as "true".
 *
 * Two design rules:
 *  - The model TRANSCRIBES and JUDGES. It never converts units or compares numbers; code does that.
 *  - Every number taken from the study comes with a word-for-word quote that code verifies.
 *
 * Strict mode requires every property to be present, so "not stated" is `null`, never missing.
 */

const duration = z
  .object({
    value: z.number().nullable().describe('The number exactly as written, or null if no duration is stated'),
    unit: z.enum(['days', 'weeks', 'months']).nullable().describe('The unit exactly as written, or null'),
  })
  .describe('A time span as stated in the text. Do not convert units.');

const quote = z
  .string()
  .nullable()
  .describe('Exact, word-for-word excerpt copied from the study text that states the value. Null when the value is null.');

export const studyDesigns = [
  'randomized_controlled',
  'controlled',
  'single_arm',
  'consumer_survey',
  'in_vitro',
  'other',
  'unclear',
] as const;

export const LlmOutputSchema = z.object({
  claim: z.object({
    metric: z.string().describe('What the claim is about, for example "wrinkle depth"'),
    direction: z
      .enum(['decrease', 'increase', 'none'])
      .describe('Direction of change the claim promises; "none" if it promises no change'),
    magnitudePercent: z
      .number()
      .nullable()
      .describe('Size of the promised change in percent (20 for "20%"); null if the claim states no percentage'),
    timeframe: duration,
  }),
  study: z.object({
    design: z.enum(studyDesigns),
    endpointMatchesClaim: z
      .boolean()
      .nullable()
      .describe('Is what the study measured what the claim is about? Null if the study does not say what was measured'),
    sampleSize: z.object({
      value: z.number().nullable().describe('Number of participants analysed, or null if not stated'),
      quote,
    }),
    effect: z.object({
      direction: z.enum(['decrease', 'increase', 'no_change']).nullable(),
      percent: z
        .number()
        .nullable()
        .describe('Observed change from baseline in the treated group, in percent, as a positive number; null if not stated'),
      timepoint: duration.describe('When the effect was measured'),
      quote,
    }),
    pValue: z.object({
      value: z.number().nullable().describe('p-value of the main result; use 0.001 for "p<0.001"; null if not stated'),
      quote,
    }),
  }),
  verdict: z.object({
    justified: z.boolean().describe('Does the study, as written, justify the claim?'),
    confidence: z.number().describe('Your confidence in this verdict, from 0 to 1'),
    reasoning: z.string().describe('Two to four sentences explaining the verdict, referring only to the study text'),
  }),
});

export type LlmOutput = z.infer<typeof LlmOutputSchema>;
export type LlmVerdict = LlmOutput['verdict'];
export type StudyDesign = (typeof studyDesigns)[number];
