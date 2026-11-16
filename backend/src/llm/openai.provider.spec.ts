import OpenAI from 'openai';
import { ContentFilterFinishReasonError, LengthFinishReasonError } from 'openai/core/error';
import { OpenAiProvider } from './openai.provider.js';
import { LlmOutputError, LlmUnavailableError } from './llm.provider.js';
import { LlmOutputSchema } from './llm-output.schema.js';
import { PROMPT_VERSION } from './prompt.js';
import { makeOutput } from '../claims/assessment/testing/fixtures.js';

const INPUT = {
  claimText: 'Reduces wrinkles by 20% in 4 weeks',
  evidenceText: 'Randomised study of 45 women. At week 4, wrinkle depth fell by 23% (p = 0.003).',
};

/** Shaped like the SDK's real ParsedChatCompletion, with every field a caller could read. */
function completion(options: { parsed?: unknown; refusal?: string | null; model?: string } = {}) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: options.model ?? 'test-model-2026-01-01',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: {
          role: 'assistant',
          content: '{"ignored":"the SDK already parsed this"}',
          refusal: options.refusal ?? null,
          parsed: 'parsed' in options ? options.parsed : makeOutput(),
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
  };
}

type RequestBody = {
  model: string;
  messages: { role: string; content: string }[];
  response_format: { type: string; json_schema: { name: string; strict: boolean; schema: unknown } };
  temperature?: number;
  max_completion_tokens?: number;
};

/** A stand-in for the one SDK call we make. Records every request; `reply` decides what comes back. */
function stubClient(reply: () => unknown) {
  const requests: RequestBody[] = [];
  const client = {
    chat: {
      completions: {
        parse: async (body: RequestBody) => {
          requests.push(body);
          return reply();
        },
      },
    },
  } as unknown as OpenAI;
  return { client, requests };
}

function provider(reply: () => unknown, options: { temperature?: number } = {}, newToken?: () => string) {
  const { client, requests } = stubClient(reply);
  return { requests, provider: new OpenAiProvider(client, { model: 'test-model', ...options }, newToken) };
}

describe('OpenAiProvider', () => {
  it('returns the parsed output with what is needed to reproduce it later', async () => {
    const { provider: p } = provider(() => completion({ model: 'test-model-2026-01-01' }));

    const result = await p.assess(INPUT);

    expect(result.output).toEqual(makeOutput());
    expect(result.meta.model).toBe('test-model-2026-01-01'); // the exact snapshot the API used, not just our alias
    expect(result.meta.promptVersion).toBe(PROMPT_VERSION);
    expect(result.meta.inputTokens).toBe(120);
    expect(result.meta.outputTokens).toBe(80);
    expect(result.meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('asks for a strict JSON-schema answer from the configured model, with the study text in the user message', async () => {
    const { provider: p, requests } = provider(() => completion());

    await p.assess(INPUT);

    const body = requests[0];
    expect(body.model).toBe('test-model');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.messages[1].content).toContain(INPUT.evidenceText);
    expect(body.messages[1].content).toContain(INPUT.claimText);
    expect(body.max_completion_tokens).toBeGreaterThan(0); // a cost guard: the answer can never run on forever
  });

  it('sends a temperature only when one is configured, because some models reject it', async () => {
    const without = provider(() => completion());
    const withZero = provider(() => completion(), { temperature: 0 });

    await without.provider.assess(INPUT);
    await withZero.provider.assess(INPUT);

    expect('temperature' in without.requests[0]).toBe(false);
    expect(withZero.requests[0].temperature).toBe(0);
  });

  it('sends a JSON schema that meets OpenAI strict-mode rules: every property required, no extras allowed', async () => {
    const { provider: p, requests } = provider(() => completion());

    await p.assess(INPUT);

    expect(strictModeViolations(requests[0].response_format.json_schema.schema)).toEqual([]);
  });

  it('sends a JSON schema that describes the same shape the code validates the answer against', async () => {
    const { provider: p, requests } = provider(() => completion());

    await p.assess(INPUT);

    const schema = requests[0].response_format.json_schema.schema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(LlmOutputSchema.shape).sort());
  });

  it('uses a fresh random delimiter token for every request', async () => {
    const { provider: p, requests } = provider(() => completion());

    await p.assess(INPUT);
    await p.assess(INPUT);

    const tokens = requests.map((r) => /<study-([^>]+)>/.exec(r.messages[1].content)?.[1]);
    expect(tokens[0]).toBeTruthy();
    expect(tokens[1]).toBeTruthy();
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  describe('when the model answers but the answer is unusable', () => {
    it('reports a refusal', async () => {
      const { provider: p } = provider(() => completion({ parsed: null, refusal: 'I cannot help with that.' }));

      await expect(p.assess(INPUT)).rejects.toMatchObject({ name: 'LlmOutputError', problem: 'refusal' });
    });

    it('reports an answer that was cut off at the token limit', async () => {
      const { provider: p } = provider(() => {
        throw new LengthFinishReasonError();
      });

      await expect(p.assess(INPUT)).rejects.toMatchObject({ name: 'LlmOutputError', problem: 'truncated' });
    });

    it('reports an answer stopped by the content filter', async () => {
      const { provider: p } = provider(() => {
        throw new ContentFilterFinishReasonError();
      });

      await expect(p.assess(INPUT)).rejects.toMatchObject({ name: 'LlmOutputError', problem: 'content_filter' });
    });

    it.each([
      { name: 'text that is not JSON', error: new SyntaxError('Unexpected token') },
      { name: 'JSON that does not match the schema', error: LlmOutputSchema.safeParse({}).error },
    ])('reports $name as invalid', async ({ error }) => {
      const { provider: p } = provider(() => {
        throw error;
      });

      await expect(p.assess(INPUT)).rejects.toMatchObject({ name: 'LlmOutputError', problem: 'invalid' });
    });

    it('reports an empty answer', async () => {
      const { provider: p } = provider(() => completion({ parsed: null }));

      await expect(p.assess(INPUT)).rejects.toMatchObject({ name: 'LlmOutputError', problem: 'empty' });
    });

    it('is an LlmOutputError, so callers can tell it apart from an outage', async () => {
      const { provider: p } = provider(() => completion({ parsed: null, refusal: 'no' }));

      await expect(p.assess(INPUT)).rejects.toBeInstanceOf(LlmOutputError);
    });
  });

  describe('when the provider cannot be used', () => {
    it.each([
      { name: 'rate limited', error: OpenAI.APIError.generate(429, { message: 'slow down' }, 'Rate limited', new Headers()) },
      { name: 'down', error: OpenAI.APIError.generate(503, { message: 'unavailable' }, 'Unavailable', new Headers()) },
      { name: 'rejecting our key', error: OpenAI.APIError.generate(401, { message: 'bad key' }, 'Unauthorized', new Headers()) },
      { name: 'unreachable', error: new OpenAI.APIConnectionError({ message: 'connect ECONNREFUSED' }) },
    ])('reports the provider as unavailable when it is $name', async ({ error }) => {
      const { provider: p } = provider(() => {
        throw error;
      });

      const failure: unknown = await p.assess(INPUT).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(failure).toBeInstanceOf(LlmUnavailableError);
      expect((failure as Error).message).not.toMatch(/bad key|slow down|ECONNREFUSED|Unavailable/); // no vendor detail for API clients
      expect((failure as Error).cause).toBe(error); // but the original is kept for the logs
    });

    it('does not disguise a programming error as an outage', async () => {
      const { provider: p } = provider(() => {
        throw new TypeError('x is not a function');
      });

      await expect(p.assess(INPUT)).rejects.toBeInstanceOf(TypeError);
    });
  });
});

/** OpenAI's strict mode needs every object to list all its properties as required and forbid extras. */
function strictModeViolations(node: unknown, path = '#'): string[] {
  if (node === null || typeof node !== 'object') return [];
  const found: string[] = [];
  const schema = node as Record<string, unknown>;
  if (schema.type === 'object') {
    const properties = Object.keys((schema.properties as object | undefined) ?? {});
    const required = (schema.required as string[] | undefined) ?? [];
    if (schema.additionalProperties !== false) found.push(`${path}: additionalProperties must be false`);
    for (const name of properties) {
      if (!required.includes(name)) found.push(`${path}.${name}: not listed as required`);
    }
  }
  for (const [key, child] of Object.entries(schema)) found.push(...strictModeViolations(child, `${path}/${key}`));
  return found;
}
