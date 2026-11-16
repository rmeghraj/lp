import { parseConfig } from './config.js';

const DB = { DATABASE_URL: 'postgresql://claims:claims@localhost:5432/claims' };

describe('parseConfig', () => {
  it('needs no API key when the fake provider is selected, and fills in the defaults', () => {
    const config = parseConfig({ ...DB, LLM_PROVIDER: 'fake' });

    expect(config).toEqual({
      port: 3000,
      corsOrigin: 'http://localhost:5173',
      databaseUrl: DB.DATABASE_URL,
      llm: { provider: 'fake' },
    });
  });

  it('reads every OpenAI setting', () => {
    const config = parseConfig({
      ...DB,
      PORT: '4000',
      CORS_ORIGIN: 'https://claims.example.com',
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'some-model',
      OPENAI_TEMPERATURE: '0',
      OPENAI_TIMEOUT_MS: '15000',
    });

    expect(config.port).toBe(4000);
    expect(config.corsOrigin).toBe('https://claims.example.com');
    expect(config.llm).toEqual({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'some-model',
      temperature: 0,
      timeoutMs: 15000,
    });
  });

  it('requires an API key and a model when the real provider is selected', () => {
    expect(() => parseConfig({ ...DB, LLM_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY[\s\S]*OPENAI_MODEL/);
  });

  it('defaults to the real provider, so a forgotten setting can never silently run the fake', () => {
    expect(() => parseConfig({ ...DB })).toThrow(/OPENAI_API_KEY/);
  });

  it('treats blank optional values as unset, not as zero', () => {
    const blank = parseConfig({ ...DB, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm', OPENAI_TEMPERATURE: '' });
    const zero = parseConfig({ ...DB, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm', OPENAI_TEMPERATURE: '0' });

    expect(blank.llm).toMatchObject({ temperature: undefined, timeoutMs: 60000 });
    expect(zero.llm).toMatchObject({ temperature: 0 });
  });

  it('rejects a missing database URL', () => {
    expect(() => parseConfig({ LLM_PROVIDER: 'fake' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a port that is not a number', () => {
    expect(() => parseConfig({ ...DB, LLM_PROVIDER: 'fake', PORT: 'abc' })).toThrow(/PORT/);
  });
});
