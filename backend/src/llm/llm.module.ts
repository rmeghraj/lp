import { Logger, Module } from '@nestjs/common';
import OpenAI from 'openai';
import type { AppConfig } from '../config/config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { FakeLlmProvider } from './fake.provider.js';
import { LlmProvider } from './llm.provider.js';
import { OpenAiProvider } from './openai.provider.js';

/** Picks the real or the offline provider from configuration. Nothing else in the app knows which one it got. */
export function createLlmProvider(config: AppConfig): LlmProvider {
  const logger = new Logger('LlmModule');

  if (config.llm.provider === 'fake') {
    logger.warn('LLM_PROVIDER=fake: answers come from a simple text-matching stand-in, not a model. Demo and testing only.');
    return new FakeLlmProvider();
  }

  const { apiKey, model, temperature, timeoutMs } = config.llm;
  logger.log(`Using OpenAI model "${model}" (timeout ${timeoutMs} ms, up to 2 automatic retries)`);
  return new OpenAiProvider(new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 2 }), { model, temperature });
}

@Module({
  providers: [{ provide: LlmProvider, useFactory: createLlmProvider, inject: [APP_CONFIG] }],
  exports: [LlmProvider],
})
export class LlmModule {}
