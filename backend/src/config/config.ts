import { z } from 'zod';

export type LlmConfig =
  | { provider: 'fake' }
  | { provider: 'openai'; apiKey: string; model: string; temperature?: number; timeoutMs: number };

export interface AppConfig {
  port: number;
  corsOrigin: string;
  databaseUrl: string;
  llm: LlmConfig;
}

/** `FOO=` in a .env file arrives as an empty string; for optional settings that means "not set". */
const unlessBlank = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema);

const RawEnv = z.object({
  PORT: unlessBlank(z.coerce.number().int().min(1).max(65535).default(3000)),
  CORS_ORIGIN: unlessBlank(z.string().default('http://localhost:5173')),
  DATABASE_URL: z.string().min(1),
  // Defaults to the real provider on purpose: a forgotten setting must never silently run the fake.
  LLM_PROVIDER: unlessBlank(z.enum(['openai', 'fake']).default('openai')),
  OPENAI_API_KEY: unlessBlank(z.string().optional()),
  OPENAI_MODEL: unlessBlank(z.string().optional()),
  OPENAI_TEMPERATURE: unlessBlank(z.coerce.number().min(0).max(2).optional()),
  OPENAI_TIMEOUT_MS: unlessBlank(z.coerce.number().int().positive().default(60_000)),
});

/**
 * Reads and checks the environment once, at startup. A bad setting stops the app immediately with a
 * readable message, instead of failing on the first request. "Parse, don't validate": the result is a
 * typed config in which, for example, an OpenAI config always has its key and model.
 */
export function parseConfig(source: Record<string, string | undefined>): AppConfig {
  const parsed = RawEnv.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;

  return {
    port: env.PORT,
    corsOrigin: env.CORS_ORIGIN,
    databaseUrl: env.DATABASE_URL,
    llm: llmConfig(env),
  };
}

function llmConfig(env: z.infer<typeof RawEnv>): LlmConfig {
  if (env.LLM_PROVIDER === 'fake') return { provider: 'fake' };

  const apiKey = env.OPENAI_API_KEY;
  const model = env.OPENAI_MODEL;
  if (!apiKey || !model) {
    const missing = [apiKey ? null : 'OPENAI_API_KEY', model ? null : 'OPENAI_MODEL'].filter(Boolean);
    throw new Error(
      `Invalid configuration:\n  - ${missing.join(' and ')} must be set when LLM_PROVIDER=openai (use LLM_PROVIDER=fake to run offline)`,
    );
  }
  return { provider: 'openai', apiKey, model, temperature: env.OPENAI_TEMPERATURE, timeoutMs: env.OPENAI_TIMEOUT_MS };
}
